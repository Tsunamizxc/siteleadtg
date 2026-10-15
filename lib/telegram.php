<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function lead_statuses()
{
    return array('active', 'progress', 'cancelled', 'closed');
}

function lead_status_label($status)
{
    $labels = array(
        'active' => 'активный',
        'progress' => 'в работе',
        'cancelled' => 'отменен',
        'closed' => 'закрыт',
    );

    return isset($labels[$status]) ? $labels[$status] : $status;
}

function phone_href($phone)
{
    $digits = preg_replace('/\D+/', '', (string) $phone);
    if (!is_string($digits) || strlen($digits) < 6) {
        return '';
    }
    if (strlen($digits) === 11 && $digits[0] === '8') {
        $digits = '7' . substr($digits, 1);
    }
    if (strlen($digits) === 10) {
        $digits = '7' . $digits;
    }

    return 'tel:+' . $digits;
}

function format_moment($timestamp)
{
    $months = array(
        1 => 'января',
        2 => 'февраля',
        3 => 'марта',
        4 => 'апреля',
        5 => 'мая',
        6 => 'июня',
        7 => 'июля',
        8 => 'августа',
        9 => 'сентября',
        10 => 'октября',
        11 => 'ноября',
        12 => 'декабря',
    );
    $timestamp = (int) $timestamp;
    $month = (int) date('n', $timestamp);
    $name = isset($months[$month]) ? $months[$month] : '';

    return date('j', $timestamp) . ' ' . $name . ', ' . date('H:i', $timestamp);
}

function present_lead(array $row)
{
    $created = (int) $row['created_at'];
    $updated = (int) $row['updated_at'];

    return array(
        'id' => (int) $row['id'],
        'name' => (string) $row['name'],
        'phone' => (string) $row['phone'],
        'phone_href' => phone_href($row['phone']),
        'source' => (string) $row['source'],
        'service' => (string) $row['service'],
        'page' => (string) $row['page'],
        'description' => (string) $row['description'],
        'promo' => (string) $row['promo'],
        'messenger' => (string) $row['messenger'],
        'city' => (string) $row['city'],
        'traffic' => (string) $row['traffic'],
        'form_type' => (string) $row['form_type'],
        'status' => (string) $row['status'],
        'note' => isset($row['note']) ? (string) $row['note'] : '',
        'created_label' => $created ? format_moment($created) : '',
        'updated_label' => ($updated && $updated !== $created) ? format_moment($updated) : '',
    );
}

function lead_message(array $row)
{
    $lines = array();
    $lines[] = '<b>Новая заявка с cursiva.ru</b>';
    $lines[] = '№ ' . (int) $row['id'];
    $lines[] = '';
    $lines[] = '<b>' . h($row['name']) . '</b>';
    $lines[] = h($row['phone']);

    $meta = array();
    if ($row['source'] !== '') {
        $meta[] = 'Источник: ' . $row['source'];
    }
    if ($row['service'] !== '') {
        $meta[] = 'Услуга: ' . $row['service'];
    }
    if ($row['city'] !== '') {
        $meta[] = 'Город: ' . $row['city'];
    }
    if ($row['messenger'] !== '') {
        $meta[] = 'Куда написать: ' . $row['messenger'];
    }
    if ($row['promo'] !== '') {
        $meta[] = 'Промокод: ' . $row['promo'];
    }
    if ($row['traffic'] !== '' && strpos((string) $row['traffic'], 'платн') !== false) {
        $meta[] = 'Трафик: ' . $row['traffic'];
    }
    if ($meta) {
        $lines[] = '';
        foreach ($meta as $line) {
            $lines[] = h($line);
        }
    }
    if (trim((string) $row['description']) !== '') {
        $lines[] = '';
        $lines[] = h($row['description']);
    }
    if ($row['page'] !== '') {
        $lines[] = '';
        $lines[] = h($row['page']);
    }
    if (trim((string) (isset($row['note']) ? $row['note'] : '')) !== '') {
        $lines[] = '';
        $lines[] = 'Заметка: ' . h($row['note']);
    }
    $lines[] = '';
    $lines[] = 'Статус: ' . h(lead_status_label($row['status']));

    $text = implode("\n", $lines);
    if (function_exists('mb_strlen') && mb_strlen($text) > 3900) {
        $text = mb_substr($text, 0, 3900) . '…';
    }

    return $text;
}

function office_link()
{
    static $link = null;
    if ($link !== null) {
        return $link;
    }

    $bot = (string) app_config('bot_username', 'cursivalead_bot');
    $me = tg_request('getMe', array());
    $main_app = !empty($me['ok']) && !empty($me['result']['has_main_web_app']);
    $link = 'https://t.me/' . $bot . ($main_app ? '?startapp' : '?start=office');
    return $link;
}

function lead_keyboard($chat_id = 0, $kind = 'private')
{
    $group = (int) $chat_id < 0 || $kind === 'group' || $kind === 'supergroup';
    if ($group) {
        return array(
            'inline_keyboard' => array(
                array(
                    array('text' => 'Заявки', 'callback_data' => 'leads'),
                    array('text' => 'Задачи', 'callback_data' => 'tasks'),
                ),
                array(
                    array('text' => 'Финансы', 'callback_data' => 'money'),
                    array('text' => 'Помощь', 'callback_data' => 'help'),
                ),
                array(
                    array(
                        'text' => 'Открыть офис',
                        'url' => office_link(),
                    ),
                ),
            ),
        );
    }

    $url = (string) app_config('web_app_url', 'https://cursivalead.cursiva-dev.ru/');

    return array(
        'inline_keyboard' => array(
            array(
                array(
                    'text' => 'Открыть офис',
                    'web_app' => array('url' => $url),
                ),
            ),
        ),
    );
}

function manager_chats()
{
    $rows = db()->query('SELECT telegram_id, chat_id, kind FROM chats')->fetchAll();
    if (!$rows) {
        $rows = db()->query('SELECT telegram_id, chat_id FROM managers')->fetchAll();
    }

    $chats = array();
    foreach ($rows as $row) {
        $chats[] = array(
            'telegram_id' => (int) $row['telegram_id'],
            'chat_id' => (int) $row['chat_id'],
            'kind' => isset($row['kind']) ? (string) $row['kind'] : 'private',
        );
    }

    return $chats;
}

function tg_request($method, array $params)
{
    $token = (string) app_config('bot_token', '');
    if ($token === '') {
        return array('ok' => false, 'description' => 'no token');
    }

    $url = 'https://api.telegram.org/bot' . $token . '/' . $method;
    $body = json_encode($params, JSON_UNESCAPED_UNICODE);
    $raw = false;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 8);
        $raw = curl_exec($ch);
        curl_close($ch);
    } else {
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $body,
                'timeout' => 8,
            ),
        ));
        $raw = @file_get_contents($url, false, $context);
    }

    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($decoded) ? $decoded : array('ok' => false, 'description' => 'telegram');
}

function lead_mark_delivered($lead_id, $chat_id)
{
    $lead_id = (int) $lead_id;
    $chat_id = (int) $chat_id;
    if ($lead_id < 1 || $chat_id === 0) {
        return;
    }

    $driver = (string) app_config('driver', 'sqlite');
    if ($driver === 'mysql') {
        $statement = db()->prepare(
            'INSERT IGNORE INTO lead_deliveries (lead_id, chat_id, created_at) VALUES (:lead_id, :chat_id, :created_at)'
        );
    } else {
        $statement = db()->prepare(
            'INSERT OR IGNORE INTO lead_deliveries (lead_id, chat_id, created_at) VALUES (:lead_id, :chat_id, :created_at)'
        );
    }
    $statement->execute(array(
        'lead_id' => $lead_id,
        'chat_id' => $chat_id,
        'created_at' => time(),
    ));
    lead_finish_if_complete($lead_id);
}

function lead_undelivered_chats($lead_id)
{
    $statement = db()->prepare(
        'SELECT chats.telegram_id, chats.chat_id, chats.kind
         FROM chats
         WHERE NOT EXISTS (
            SELECT 1 FROM lead_deliveries
            WHERE lead_deliveries.lead_id = :lead_id
            AND lead_deliveries.chat_id = chats.chat_id
         )'
    );
    $statement->execute(array('lead_id' => (int) $lead_id));
    $chats = array();
    foreach ($statement->fetchAll() as $row) {
        $chats[] = array(
            'telegram_id' => (int) $row['telegram_id'],
            'chat_id' => (int) $row['chat_id'],
            'kind' => (string) $row['kind'],
        );
    }

    return $chats;
}

function lead_finish_if_complete($lead_id)
{
    if (lead_undelivered_chats($lead_id)) {
        return;
    }
    if (!manager_chats()) {
        return;
    }
    leads_mark_notified($lead_id);
}

function notify_managers(array $row)
{
    $chats = lead_undelivered_chats($row['id']);
    $sent = false;
    foreach ($chats as $chat) {
        $result = tg_request('sendMessage', array(
            'chat_id' => $chat['chat_id'],
            'text' => lead_message($row),
            'parse_mode' => 'HTML',
            'disable_web_page_preview' => true,
            'reply_markup' => lead_keyboard($chat['chat_id'], $chat['kind']),
        ));
        if (!empty($result['ok'])) {
            lead_mark_delivered($row['id'], $chat['chat_id']);
            $sent = true;
            continue;
        }

        $description = isset($result['description']) ? (string) $result['description'] : '';
        if (preg_match('/blocked|chat not found|deactivated|kicked/i', $description)) {
            $drop = db()->prepare('DELETE FROM chats WHERE chat_id = :id');
            $drop->execute(array('id' => $chat['chat_id']));
        }
    }

    lead_finish_if_complete($row['id']);
    return $sent;
}
