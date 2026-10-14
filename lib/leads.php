<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function leads_find_attempt($attempt)
{
    if ($attempt === null || $attempt === '') {
        return null;
    }

    $statement = db()->prepare('SELECT * FROM leads WHERE attempt = :attempt LIMIT 1');
    $statement->execute(array('attempt' => $attempt));
    $row = $statement->fetch();
    return $row ? $row : null;
}

function leads_get($id)
{
    $statement = db()->prepare('SELECT * FROM leads WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
    $row = $statement->fetch();
    return $row ? $row : null;
}

function leads_mark_notified($id)
{
    $statement = db()->prepare('UPDATE leads SET notified = 1 WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
}

function leads_create_manual(array $input)
{
    $source = clip_text(isset($input['source']) ? $input['source'] : '', 255);
    $input['source'] = $source !== '' ? $source : 'вручную';
    $input['form_type'] = 'manual';
    $input['traffic'] = '';
    $input['attempt'] = 'manual-' . bin2hex(random_bytes(8));
    return leads_create($input);
}

function leads_create(array $input)
{
    $phone = clip_text(isset($input['phone']) ? $input['phone'] : '', 40);
    $digits = preg_replace('/\D+/', '', $phone);
    if (!is_string($digits) || strlen($digits) < 6) {
        json_out(array('ok' => false, 'error' => 'phone'), 400);
    }

    $attempt = clip_text(isset($input['attempt']) ? $input['attempt'] : '', 80);
    if ($attempt === '') {
        $attempt = null;
    }

    $existing = leads_find_attempt($attempt);
    if ($existing) {
        return array('ok' => true, 'id' => (int) $existing['id'], 'duplicate' => true);
    }

    $name = clip_text(isset($input['name']) ? $input['name'] : '', 160);
    if ($name === '') {
        $name = 'Клиент';
    }

    $now = time();
    $statement = db()->prepare(
        'INSERT INTO leads
        (attempt, name, phone, source, service, page, description, promo, messenger, city, form_type, traffic, status, notified, created_at, updated_at)
        VALUES
        (:attempt, :name, :phone, :source, :service, :page, :description, :promo, :messenger, :city, :form_type, :traffic, :status, 0, :created_at, :updated_at)'
    );
    $statement->execute(array(
        'attempt' => $attempt,
        'name' => $name,
        'phone' => $phone,
        'source' => clip_text(isset($input['source']) ? $input['source'] : '', 255),
        'service' => clip_text(isset($input['service']) ? $input['service'] : '', 255),
        'page' => clip_text(isset($input['page']) ? $input['page'] : '', 500),
        'description' => clip_text(isset($input['description']) ? $input['description'] : '', 8000),
        'promo' => clip_text(isset($input['promo']) ? $input['promo'] : '', 80),
        'messenger' => clip_text(isset($input['messenger']) ? $input['messenger'] : '', 80),
        'city' => clip_text(isset($input['city']) ? $input['city'] : '', 160),
        'form_type' => clip_text(isset($input['form_type']) ? $input['form_type'] : '', 40),
        'traffic' => clip_text(isset($input['traffic']) ? $input['traffic'] : '', 80),
        'status' => 'active',
        'created_at' => $now,
        'updated_at' => $now,
    ));

    $id = (int) db()->lastInsertId();
    $row = leads_get($id);
    if ($row && notify_managers($row)) {
        leads_mark_notified($id);
    }

    return array('ok' => true, 'id' => $id, 'duplicate' => false);
}

function leads_counts()
{
    $counts = array(
        'all' => 0,
        'active' => 0,
        'progress' => 0,
        'cancelled' => 0,
        'closed' => 0,
    );

    $rows = db()->query('SELECT status, COUNT(*) AS total FROM leads GROUP BY status')->fetchAll();
    foreach ($rows as $row) {
        $status = (string) $row['status'];
        $total = (int) $row['total'];
        $counts['all'] += $total;
        if (isset($counts[$status])) {
            $counts[$status] = $total;
        }
    }

    return $counts;
}

function leads_list($status)
{
    $status = (string) $status;
    if ($status !== '' && !in_array($status, lead_statuses(), true)) {
        $status = '';
    }

    if ($status === '') {
        $rows = db()->query('SELECT * FROM leads ORDER BY created_at DESC, id DESC LIMIT 300')->fetchAll();
    } else {
        $statement = db()->prepare('SELECT * FROM leads WHERE status = :status ORDER BY created_at DESC, id DESC LIMIT 300');
        $statement->execute(array('status' => $status));
        $rows = $statement->fetchAll();
    }

    $leads = array();
    foreach ($rows as $row) {
        $leads[] = present_lead($row);
    }

    return array(
        'ok' => true,
        'leads' => $leads,
        'counts' => leads_counts(),
    );
}

function leads_set_note($id, $note)
{
    $current = leads_get($id);
    if (!$current) {
        json_out(array('ok' => false, 'error' => 'missing', 'message' => 'Заявка не найдена.'), 404);
    }

    $statement = db()->prepare('UPDATE leads SET note = :note, updated_at = :updated_at WHERE id = :id');
    $statement->execute(array(
        'note' => clip_text($note, 2000),
        'updated_at' => time(),
        'id' => (int) $id,
    ));

    return array('ok' => true, 'lead' => present_lead(leads_get($id)));
}

function leads_set_status($id, $status)
{
    if (!in_array($status, lead_statuses(), true)) {
        json_out(array('ok' => false, 'error' => 'status', 'message' => 'Такого статуса нет.'), 400);
    }

    $current = leads_get($id);
    if (!$current) {
        json_out(array('ok' => false, 'error' => 'missing', 'message' => 'Заявка не найдена.'), 404);
    }

    $statement = db()->prepare('UPDATE leads SET status = :status, updated_at = :updated_at WHERE id = :id');
    $statement->execute(array(
        'status' => $status,
        'updated_at' => time(),
        'id' => (int) $id,
    ));

    $row = leads_get($id);
    return array(
        'ok' => true,
        'lead' => present_lead($row),
        'counts' => leads_counts(),
    );
}

function leads_pending()
{
    $now = time();
    $statement = db()->prepare(
        'SELECT * FROM leads WHERE notified = 0 AND created_at <= :ready AND created_at >= :since ORDER BY id ASC LIMIT 20'
    );
    $statement->execute(array(
        'ready' => $now - 15,
        'since' => $now - 86400,
    ));

    $items = array();
    foreach ($statement->fetchAll() as $row) {
        $items[] = array(
            'id' => (int) $row['id'],
            'text' => lead_message($row),
            'reply_markup' => lead_keyboard(),
            'chats' => manager_chats(),
        );
    }

    return array('ok' => true, 'items' => $items);
}

function leads_ack(array $ids)
{
    $clean = array();
    foreach ($ids as $id) {
        $id = (int) $id;
        if ($id > 0) {
            $clean[] = $id;
        }
    }
    $clean = array_values(array_unique($clean));
    if (!$clean) {
        return array('ok' => true, 'updated' => 0);
    }

    $placeholders = array();
    $params = array();
    foreach ($clean as $index => $id) {
        $key = 'id' . $index;
        $placeholders[] = ':' . $key;
        $params[$key] = $id;
    }

    $statement = db()->prepare('UPDATE leads SET notified = 1 WHERE id IN (' . implode(',', $placeholders) . ')');
    $statement->execute($params);
    return array('ok' => true, 'updated' => $statement->rowCount());
}

function managers_save(array $input)
{
    $telegramId = isset($input['telegram_id']) ? (int) $input['telegram_id'] : 0;
    $chatId = isset($input['chat_id']) ? (int) $input['chat_id'] : 0;
    if ($telegramId <= 0 || $chatId === 0) {
        json_out(array('ok' => false, 'error' => 'manager'), 400);
    }

    $name = clip_text(isset($input['name']) ? $input['name'] : '', 160);
    $now = time();
    $driver = (string) app_config('driver', 'sqlite');

    if ($driver === 'mysql') {
        $statement = db()->prepare(
            'INSERT INTO managers (telegram_id, chat_id, name, created_at)
             VALUES (:telegram_id, :chat_id, :name, :created_at)
             ON DUPLICATE KEY UPDATE chat_id = VALUES(chat_id), name = VALUES(name)'
        );
    } else {
        $statement = db()->prepare(
            'INSERT INTO managers (telegram_id, chat_id, name, created_at)
             VALUES (:telegram_id, :chat_id, :name, :created_at)
             ON CONFLICT(telegram_id) DO UPDATE SET chat_id = excluded.chat_id, name = excluded.name'
        );
    }

    $statement->execute(array(
        'telegram_id' => $telegramId,
        'chat_id' => $chatId,
        'name' => $name,
        'created_at' => $now,
    ));

    return array('ok' => true);
}

function managers_remove($telegramId)
{
    $statement = db()->prepare('DELETE FROM managers WHERE telegram_id = :id');
    $statement->execute(array('id' => (int) $telegramId));
    return array('ok' => true);
}
