<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function task_present(array $row)
{
    return array(
        'id' => (int) $row['id'],
        'title' => (string) $row['title'],
        'details' => (string) $row['details'],
        'done' => (int) $row['done'] === 1,
        'created_label' => format_moment((int) $row['created_at']),
        'updated_label' => format_moment((int) $row['updated_at']),
    );
}

function tasks_list()
{
    $rows = db()->query('SELECT * FROM tasks ORDER BY done ASC, updated_at DESC, id DESC')->fetchAll();
    $tasks = array();
    $open = 0;
    foreach ($rows as $row) {
        $task = task_present($row);
        if (!$task['done']) {
            $open += 1;
        }
        $tasks[] = $task;
    }

    return array(
        'ok' => true,
        'tasks' => $tasks,
        'open' => $open,
    );
}

function tasks_get($id)
{
    $statement = db()->prepare('SELECT * FROM tasks WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
    $row = $statement->fetch();
    return $row ? $row : null;
}

function tasks_add(array $input, $actor_id)
{
    $title = clip_text(isset($input['title']) ? $input['title'] : '', 255);
    if ($title === '') {
        json_out(array('ok' => false, 'error' => 'title', 'message' => 'Напишите, что нужно сделать.'), 400);
    }

    $now = time();
    $statement = db()->prepare(
        'INSERT INTO tasks (title, details, done, created_by, created_at, updated_at)
         VALUES (:title, :details, 0, :created_by, :created_at, :updated_at)'
    );
    $statement->execute(array(
        'title' => $title,
        'details' => clip_text(isset($input['details']) ? $input['details'] : '', 4000),
        'created_by' => (int) $actor_id,
        'created_at' => $now,
        'updated_at' => $now,
    ));

    $row = tasks_get((int) db()->lastInsertId());
    return array(
        'ok' => true,
        'task' => task_present($row),
        'open' => tasks_list()['open'],
    );
}

function tasks_update(array $input)
{
    $row = tasks_get(isset($input['id']) ? $input['id'] : 0);
    if (!$row) {
        json_out(array('ok' => false, 'error' => 'task', 'message' => 'Задача не найдена.'), 404);
    }

    $title = array_key_exists('title', $input) ? clip_text($input['title'], 255) : (string) $row['title'];
    if ($title === '') {
        json_out(array('ok' => false, 'error' => 'title', 'message' => 'У задачи должно быть название.'), 400);
    }
    $details = array_key_exists('details', $input) ? clip_text($input['details'], 4000) : (string) $row['details'];
    $done = array_key_exists('done', $input) ? ((int) $input['done'] ? 1 : 0) : (int) $row['done'];

    $statement = db()->prepare(
        'UPDATE tasks SET title = :title, details = :details, done = :done, updated_at = :updated_at WHERE id = :id'
    );
    $statement->execute(array(
        'title' => $title,
        'details' => $details,
        'done' => $done,
        'updated_at' => time(),
        'id' => (int) $row['id'],
    ));

    $fresh = tasks_get((int) $row['id']);
    return array(
        'ok' => true,
        'task' => task_present($fresh),
        'open' => tasks_list()['open'],
    );
}

function tasks_delete($id)
{
    $statement = db()->prepare('DELETE FROM tasks WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
    if ($statement->rowCount() < 1) {
        json_out(array('ok' => false, 'error' => 'task', 'message' => 'Задача не найдена.'), 404);
    }

    return array('ok' => true, 'open' => tasks_list()['open']);
}
