<?php

function allowed_get($telegram_id)
{
    $statement = db()->prepare('SELECT telegram_id, name, role, created_at FROM allowed_users WHERE telegram_id = :id');
    $statement->execute(array('id' => (int) $telegram_id));
    $row = $statement->fetch();
    return $row ? $row : null;
}

function allowed_count()
{
    return (int) db()->query('SELECT COUNT(*) FROM allowed_users')->fetchColumn();
}

function allowed_list()
{
    $rows = db()->query('SELECT telegram_id, name, role, created_at FROM allowed_users ORDER BY role DESC, created_at ASC')->fetchAll();
    $users = array();
    foreach ($rows as $row) {
        $users[] = array(
            'telegram_id' => (int) $row['telegram_id'],
            'name' => (string) $row['name'],
            'role' => (string) $row['role'],
        );
    }
    return $users;
}

function allowed_ensure_owner($telegram_id, $name)
{
    $telegram_id = (int) $telegram_id;
    if ($telegram_id <= 0) {
        return allowed_get(0);
    }

    $current = allowed_get($telegram_id);
    $owners = (int) db()->query("SELECT COUNT(*) FROM allowed_users WHERE role = 'owner'")->fetchColumn();
    if ($current) {
        if ($owners === 0) {
            $update = db()->prepare('UPDATE allowed_users SET role = :role, name = :name WHERE telegram_id = :id');
            $update->execute(array(
                'role' => 'owner',
                'name' => clip_text($name, 160),
                'id' => $telegram_id,
            ));
        }
        return allowed_get($telegram_id);
    }

    $insert = db()->prepare(
        'INSERT INTO allowed_users (telegram_id, name, role, created_at) VALUES (:telegram_id, :name, :role, :created_at)'
    );
    $insert->execute(array(
        'telegram_id' => $telegram_id,
        'name' => clip_text($name, 160),
        'role' => $owners === 0 ? 'owner' : 'member',
        'created_at' => time(),
    ));
    return allowed_get($telegram_id);
}

function allowed_require_actor($actor_id)
{
    $actor = allowed_get($actor_id);
    if (!$actor) {
        json_out(array('ok' => false, 'error' => 'denied', 'message' => 'Нет доступа.'), 403);
    }
    return $actor;
}

function allowed_add($telegram_id, $name, $actor_id, $max_users)
{
    $actor = allowed_require_actor($actor_id);
    if ((string) $actor['role'] !== 'owner') {
        json_out(array('ok' => false, 'error' => 'denied', 'message' => 'Добавлять людей может только владелец.'), 403);
    }

    $telegram_id = (int) $telegram_id;
    if ($telegram_id <= 0) {
        json_out(array('ok' => false, 'error' => 'user', 'message' => 'Не вижу пользователя.'), 400);
    }
    if (allowed_get($telegram_id)) {
        return array('ok' => true, 'duplicate' => true, 'users' => allowed_list(), 'count' => allowed_count());
    }

    $max_users = (int) $max_users;
    if ($max_users < 1) {
        $max_users = 5;
    }
    if (allowed_count() >= $max_users) {
        json_out(array(
            'ok' => false,
            'error' => 'limit',
            'message' => 'Уже ' . allowed_count() . ' из ' . $max_users . '. Больше добавить нельзя.',
        ), 400);
    }

    $insert = db()->prepare(
        'INSERT INTO allowed_users (telegram_id, name, role, created_at) VALUES (:telegram_id, :name, :role, :created_at)'
    );
    $insert->execute(array(
        'telegram_id' => $telegram_id,
        'name' => clip_text($name, 160),
        'role' => 'member',
        'created_at' => time(),
    ));

    return array('ok' => true, 'users' => allowed_list(), 'count' => allowed_count(), 'max' => $max_users);
}

function allowed_remove($telegram_id, $actor_id)
{
    $actor = allowed_require_actor($actor_id);
    if ((string) $actor['role'] !== 'owner') {
        json_out(array('ok' => false, 'error' => 'denied', 'message' => 'Убирать людей может только владелец.'), 403);
    }

    $telegram_id = (int) $telegram_id;
    $target = allowed_get($telegram_id);
    if (!$target) {
        json_out(array('ok' => false, 'error' => 'missing', 'message' => 'Такого пользователя нет.'), 404);
    }
    if ((string) $target['role'] === 'owner') {
        json_out(array('ok' => false, 'error' => 'owner', 'message' => 'Владельца убрать нельзя.'), 400);
    }

    $delete = db()->prepare('DELETE FROM allowed_users WHERE telegram_id = :id');
    $delete->execute(array('id' => $telegram_id));
    $chats = db()->prepare('DELETE FROM chats WHERE telegram_id = :id AND kind = :kind');
    $chats->execute(array('id' => $telegram_id, 'kind' => 'private'));

    return array('ok' => true, 'users' => allowed_list(), 'count' => allowed_count());
}

function chats_save($chat_id, $telegram_id, $title, $kind)
{
    $chat_id = (int) $chat_id;
    if ($chat_id === 0) {
        json_out(array('ok' => false, 'error' => 'chat'), 400);
    }

    $kind = $kind === 'private' ? 'private' : 'group';
    $title = clip_text($title, 255);
    $now = time();
    $driver = (string) app_config('driver', 'sqlite');
    if ($driver === 'mysql') {
        $statement = db()->prepare(
            'INSERT INTO chats (chat_id, telegram_id, title, kind, created_at)
             VALUES (:chat_id, :telegram_id, :title, :kind, :created_at)
             ON DUPLICATE KEY UPDATE telegram_id = VALUES(telegram_id), title = VALUES(title), kind = VALUES(kind)'
        );
    } else {
        $statement = db()->prepare(
            'INSERT INTO chats (chat_id, telegram_id, title, kind, created_at)
             VALUES (:chat_id, :telegram_id, :title, :kind, :created_at)
             ON CONFLICT(chat_id) DO UPDATE SET telegram_id = excluded.telegram_id, title = excluded.title, kind = excluded.kind'
        );
    }
    $statement->execute(array(
        'chat_id' => $chat_id,
        'telegram_id' => (int) $telegram_id,
        'title' => $title,
        'kind' => $kind,
        'created_at' => $now,
    ));

    return array('ok' => true);
}

function chats_remove($chat_id)
{
    $statement = db()->prepare('DELETE FROM chats WHERE chat_id = :id');
    $statement->execute(array('id' => (int) $chat_id));
    return array('ok' => true);
}

function session_open(array $input)
{
    $telegram_id = isset($input['telegram_id']) ? (int) $input['telegram_id'] : 0;
    $user = allowed_get($telegram_id);
    if (!$user) {
        json_out(array('ok' => false, 'error' => 'denied', 'message' => 'Нет доступа.'), 403);
    }

    chats_save(
        isset($input['chat_id']) ? $input['chat_id'] : $telegram_id,
        $telegram_id,
        isset($input['name']) ? $input['name'] : $user['name'],
        isset($input['kind']) ? $input['kind'] : 'private'
    );

    if (!empty($input['name'])) {
        $rename = db()->prepare('UPDATE allowed_users SET name = :name WHERE telegram_id = :id AND name = ""');
        $rename->execute(array(
            'name' => clip_text($input['name'], 160),
            'id' => $telegram_id,
        ));
    }

    return array(
        'ok' => true,
        'role' => (string) $user['role'],
        'count' => allowed_count(),
    );
}
