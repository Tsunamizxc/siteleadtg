<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function task_statuses()
{
    return array(
        'backlog' => 'Бэклог',
        'in_progress' => 'В работе',
        'review' => 'На проверке',
        'done' => 'Завершена',
    );
}

function task_priorities()
{
    return array(
        'low' => 'Низкий',
        'normal' => 'Обычный',
        'high' => 'Высокий',
        'urgent' => 'Срочный',
    );
}

function task_ids_from($value)
{
    if (is_string($value)) {
        $value = $value === '' ? array() : explode(',', $value);
    }
    if (!is_array($value)) {
        return array();
    }

    $ids = array();
    foreach ($value as $item) {
        $id = (int) $item;
        if ($id > 0 && !in_array($id, $ids, true)) {
            $ids[] = $id;
        }
    }
    return $ids;
}

function task_links_from($value)
{
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        $value = is_array($decoded) ? $decoded : preg_split('/\s+/', $value);
    }
    if (!is_array($value)) {
        return array();
    }

    $links = array();
    foreach ($value as $item) {
        $url = clip_text($item, 500);
        if ($url === '' || !preg_match('#^https?://#i', $url) || in_array($url, $links, true)) {
            continue;
        }
        $links[] = $url;
        if (count($links) >= 10) {
            break;
        }
    }
    return $links;
}

function task_deadline_from($value)
{
    $value = trim((string) $value);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : '';
}

function task_present(array $row, array $comment_counts = array())
{
    $statuses = task_statuses();
    $priorities = task_priorities();
    $status = isset($row['status']) && isset($statuses[$row['status']]) ? (string) $row['status'] : ((int) $row['done'] === 1 ? 'done' : 'backlog');
    $priority = isset($row['priority']) && isset($priorities[$row['priority']]) ? (string) $row['priority'] : 'normal';
    $deadline = isset($row['deadline']) ? (string) $row['deadline'] : '';
    $closed_at = isset($row['closed_at']) ? (int) $row['closed_at'] : 0;
    $id = (int) $row['id'];

    return array(
        'id' => $id,
        'title' => (string) $row['title'],
        'details' => (string) $row['details'],
        'status' => $status,
        'status_label' => $statuses[$status],
        'priority' => $priority,
        'priority_label' => $priorities[$priority],
        'deadline' => $deadline,
        'overdue' => $deadline !== '' && $status !== 'done' && $deadline < date('Y-m-d'),
        'group' => isset($row['group_name']) ? (string) $row['group_name'] : '',
        'assignees' => task_ids_from(isset($row['assignees']) ? (string) $row['assignees'] : ''),
        'links' => task_links_from(isset($row['links']) ? (string) $row['links'] : ''),
        'done' => $status === 'done',
        'created_by' => (int) $row['created_by'],
        'created_at' => (int) $row['created_at'],
        'updated_at' => (int) $row['updated_at'],
        'closed_at' => $closed_at,
        'created_label' => format_moment((int) $row['created_at']),
        'updated_label' => format_moment((int) $row['updated_at']),
        'closed_label' => $closed_at > 0 ? format_moment($closed_at) : '',
        'comments' => isset($comment_counts[$id]) ? $comment_counts[$id] : 0,
    );
}

function task_comment_counts()
{
    $counts = array();
    foreach (db()->query('SELECT task_id, COUNT(*) AS total FROM task_comments GROUP BY task_id')->fetchAll() as $row) {
        $counts[(int) $row['task_id']] = (int) $row['total'];
    }
    return $counts;
}

function tasks_open_count()
{
    return (int) db()->query("SELECT COUNT(*) FROM tasks WHERE status <> 'done'")->fetchColumn();
}

function tasks_list($viewer_id = 0)
{
    $counts = task_comment_counts();
    $rows = db()->query('SELECT * FROM tasks ORDER BY updated_at DESC, id DESC')->fetchAll();
    $tasks = array();
    $groups = array();
    $open = 0;
    foreach ($rows as $row) {
        $task = task_present($row, $counts);
        if (!$task['done']) {
            $open += 1;
        }
        if ($task['group'] !== '' && !in_array($task['group'], $groups, true)) {
            $groups[] = $task['group'];
        }
        $tasks[] = $task;
    }
    sort($groups);

    return array(
        'ok' => true,
        'tasks' => $tasks,
        'open' => $open,
        'groups' => $groups,
        'users' => allowed_list(),
        'me' => (int) $viewer_id,
        'today' => date('Y-m-d'),
    );
}

function tasks_get($id)
{
    $statement = db()->prepare('SELECT * FROM tasks WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
    $row = $statement->fetch();
    return $row ? $row : null;
}

function task_allowed_ids(array $ids)
{
    $known = array();
    foreach (allowed_list() as $user) {
        $known[] = (int) $user['telegram_id'];
    }
    return array_values(array_filter($ids, function ($id) use ($known) {
        return in_array($id, $known, true);
    }));
}

function task_fields(array $input, array $row = null)
{
    $statuses = task_statuses();
    $priorities = task_priorities();
    $fields = array();

    if (array_key_exists('title', $input) || !$row) {
        $fields['title'] = clip_text(isset($input['title']) ? $input['title'] : '', 255);
        if ($fields['title'] === '') {
            json_out(array('ok' => false, 'error' => 'title', 'message' => 'Напишите, что нужно сделать.'), 400);
        }
    }
    if (array_key_exists('details', $input) || !$row) {
        $fields['details'] = clip_text(isset($input['details']) ? $input['details'] : '', 4000);
    }

    $status = null;
    if (array_key_exists('status', $input) && isset($statuses[(string) $input['status']])) {
        $status = (string) $input['status'];
    } elseif (array_key_exists('done', $input)) {
        $status = (int) $input['done'] ? 'done' : ($row && (string) $row['status'] !== 'done' ? (string) $row['status'] : 'in_progress');
    } elseif (!$row) {
        $status = 'backlog';
    }
    if ($status !== null) {
        $fields['status'] = $status;
        $fields['done'] = $status === 'done' ? 1 : 0;
        $was_done = $row && (string) $row['status'] === 'done';
        if ($status === 'done' && !$was_done) {
            $fields['closed_at'] = time();
        } elseif ($status !== 'done') {
            $fields['closed_at'] = 0;
        }
    }

    if (array_key_exists('priority', $input) || !$row) {
        $priority = isset($input['priority']) ? (string) $input['priority'] : 'normal';
        $fields['priority'] = isset($priorities[$priority]) ? $priority : 'normal';
    }
    if (array_key_exists('deadline', $input) || !$row) {
        $fields['deadline'] = task_deadline_from(isset($input['deadline']) ? $input['deadline'] : '');
    }
    if (array_key_exists('group', $input) || !$row) {
        $fields['group_name'] = clip_text(isset($input['group']) ? $input['group'] : '', 80);
    }
    if (array_key_exists('assignees', $input) || !$row) {
        $fields['assignees'] = implode(',', task_allowed_ids(task_ids_from(isset($input['assignees']) ? $input['assignees'] : array())));
    }
    if (array_key_exists('links', $input) || !$row) {
        $fields['links'] = json_encode(task_links_from(isset($input['links']) ? $input['links'] : array()), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    return $fields;
}

function task_lower($text)
{
    return function_exists('mb_strtolower') ? mb_strtolower((string) $text, 'UTF-8') : (string) $text;
}

function task_notice_title(array $task)
{
    return 'Задача № ' . $task['id'] . ' «' . $task['title'] . '»';
}

function task_people(array $ids)
{
    $names = array();
    foreach ($ids as $id) {
        $names[] = actor_name($id);
    }
    return implode(', ', $names);
}

function tasks_add(array $input, $actor_id, $skip_chat = 0)
{
    $fields = task_fields($input);
    $now = time();
    $fields['created_by'] = (int) $actor_id;
    $fields['created_at'] = $now;
    $fields['updated_at'] = $now;

    $names = array_keys($fields);
    $statement = db()->prepare(
        'INSERT INTO tasks (' . implode(', ', $names) . ') VALUES (:' . implode(', :', $names) . ')'
    );
    $statement->execute($fields);

    $row = tasks_get((int) db()->lastInsertId());
    $task = task_present($row);
    $lines = array('📝 Новая задача № ' . $task['id'] . ': ' . $task['title'], 'Добавил(а): ' . actor_name($actor_id));
    $extra = array($task['status_label']);
    if ($task['priority'] !== 'normal') {
        $extra[] = task_lower($task['priority_label']);
    }
    if ($task['deadline'] !== '') {
        $extra[] = 'срок ' . $task['deadline'];
    }
    $lines[] = implode(' · ', $extra);
    if ($task['assignees']) {
        $lines[] = 'Исполнители: ' . task_people($task['assignees']);
    }
    notify_team(implode("\n", $lines), $actor_id, 'tasks', $skip_chat);

    return array(
        'ok' => true,
        'task' => task_present($row, task_comment_counts()),
        'open' => tasks_open_count(),
    );
}

function tasks_update(array $input, $actor_id = 0, $skip_chat = 0)
{
    $row = tasks_get(isset($input['id']) ? $input['id'] : 0);
    if (!$row) {
        json_out(array('ok' => false, 'error' => 'task', 'message' => 'Задача не найдена.'), 404);
    }

    $before = task_present($row);
    $fields = task_fields($input, $row);
    $fields['updated_at'] = time();
    $sets = array();
    foreach (array_keys($fields) as $name) {
        $sets[] = $name . ' = :' . $name;
    }
    $fields['id'] = (int) $row['id'];
    $statement = db()->prepare('UPDATE tasks SET ' . implode(', ', $sets) . ' WHERE id = :id');
    $statement->execute($fields);

    $after = task_present(tasks_get((int) $row['id']), task_comment_counts());
    $changes = array();
    if ($before['status'] !== $after['status']) {
        $changes[] = 'статус: ' . $after['status_label'];
    }
    if ($before['priority'] !== $after['priority']) {
        $changes[] = 'приоритет: ' . task_lower($after['priority_label']);
    }
    if ($before['deadline'] !== $after['deadline']) {
        $changes[] = $after['deadline'] !== '' ? 'срок: ' . $after['deadline'] : 'срок снят';
    }
    $added = array_diff($after['assignees'], $before['assignees']);
    if ($added) {
        $changes[] = 'исполнители: + ' . task_people($added);
    }
    if ($before['title'] !== $after['title'] || $before['details'] !== $after['details'] || $before['group'] !== $after['group'] || $before['links'] !== $after['links']) {
        $changes[] = 'описание изменено';
    }
    if ($changes) {
        $icon = $after['status'] === 'done' && $before['status'] !== 'done' ? '✅ ' : '✏️ ';
        notify_team(
            $icon . task_notice_title($after) . "\n" . implode("\n", $changes) . "\n— " . actor_name($actor_id),
            $actor_id,
            'tasks',
            $skip_chat
        );
    }

    return array(
        'ok' => true,
        'task' => $after,
        'open' => tasks_open_count(),
    );
}

function tasks_delete($id, $actor_id = 0)
{
    $row = tasks_get($id);
    if ($row) {
        notify_team('🗑 ' . task_notice_title(task_present($row)) . ' удалена — ' . actor_name($actor_id), $actor_id, 'tasks');
    }
    $statement = db()->prepare('DELETE FROM tasks WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
    if ($statement->rowCount() < 1) {
        json_out(array('ok' => false, 'error' => 'task', 'message' => 'Задача не найдена.'), 404);
    }
    $comments = db()->prepare('DELETE FROM task_comments WHERE task_id = :id');
    $comments->execute(array('id' => (int) $id));

    return array('ok' => true, 'open' => tasks_open_count());
}

function task_comments_list($task_id)
{
    if (!tasks_get($task_id)) {
        json_out(array('ok' => false, 'error' => 'task', 'message' => 'Задача не найдена.'), 404);
    }

    $statement = db()->prepare(
        'SELECT task_comments.*, allowed_users.name AS author_name
         FROM task_comments
         LEFT JOIN allowed_users ON allowed_users.telegram_id = task_comments.author_id
         WHERE task_comments.task_id = :id
         ORDER BY task_comments.created_at ASC, task_comments.id ASC'
    );
    $statement->execute(array('id' => (int) $task_id));
    $comments = array();
    foreach ($statement->fetchAll() as $row) {
        $comments[] = array(
            'id' => (int) $row['id'],
            'author_id' => (int) $row['author_id'],
            'author' => $row['author_name'] !== null && $row['author_name'] !== '' ? (string) $row['author_name'] : 'Участник',
            'body' => (string) $row['body'],
            'created_label' => format_moment((int) $row['created_at']),
        );
    }

    return array('ok' => true, 'comments' => $comments);
}

function task_comment_add($task_id, $author_id, $body)
{
    $body = clip_text($body, 2000);
    if ($body === '') {
        json_out(array('ok' => false, 'error' => 'body', 'message' => 'Напишите комментарий.'), 400);
    }
    $row = tasks_get($task_id);
    if (!$row) {
        json_out(array('ok' => false, 'error' => 'task', 'message' => 'Задача не найдена.'), 404);
    }
    notify_team('💬 ' . actor_name($author_id) . ' → ' . task_notice_title(task_present($row)) . ":\n" . $body, $author_id, 'tasks');

    $statement = db()->prepare(
        'INSERT INTO task_comments (task_id, author_id, body, created_at) VALUES (:task_id, :author_id, :body, :created_at)'
    );
    $statement->execute(array(
        'task_id' => (int) $task_id,
        'author_id' => (int) $author_id,
        'body' => $body,
        'created_at' => time(),
    ));
    $touch = db()->prepare('UPDATE tasks SET updated_at = :now WHERE id = :id');
    $touch->execute(array('now' => time(), 'id' => (int) $task_id));

    return task_comments_list($task_id);
}
