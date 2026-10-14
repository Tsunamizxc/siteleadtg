<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function require_bot()
{
    if (!secret_ok(header_value('X-Bot-Secret'), (string) app_config('bot_secret', ''))) {
        json_out(array('ok' => false, 'error' => 'forbidden'), 403);
    }
}

function require_lead_secret()
{
    if (!secret_ok(header_value('X-Lead-Secret'), (string) app_config('lead_secret', ''))) {
        json_out(array('ok' => false, 'error' => 'forbidden'), 403);
    }
}

function telegram_user_from_init($initData)
{
    $parsed = array();
    foreach (explode('&', (string) $initData) as $chunk) {
        if ($chunk === '') {
            continue;
        }
        $eq = strpos($chunk, '=');
        if ($eq === false) {
            continue;
        }
        $key = rawurldecode(substr($chunk, 0, $eq));
        $value = rawurldecode(substr($chunk, $eq + 1));
        $parsed[$key] = $value;
    }

    $hash = isset($parsed['hash']) ? (string) $parsed['hash'] : '';
    unset($parsed['hash']);
    if ($hash === '' || !$parsed) {
        return null;
    }

    ksort($parsed);
    $lines = array();
    foreach ($parsed as $key => $value) {
        $lines[] = $key . '=' . $value;
    }

    $token = (string) app_config('bot_token', '');
    if ($token === '') {
        return null;
    }

    $secret = hash_hmac('sha256', $token, 'WebAppData', true);
    $calculated = hash_hmac('sha256', implode("\n", $lines), $secret);
    if (!hash_equals($calculated, $hash)) {
        return null;
    }

    $authDate = isset($parsed['auth_date']) ? (int) $parsed['auth_date'] : 0;
    if ($authDate < time() - 172800) {
        return null;
    }

    $user = json_decode(isset($parsed['user']) ? $parsed['user'] : '', true);
    if (!is_array($user) || empty($user['id'])) {
        return null;
    }

    return $user;
}

function init_data_header()
{
    $header = header_value('X-Telegram-Init-Data');
    if ($header !== '') {
        return $header;
    }

    $authorization = header_value('Authorization');
    if (stripos($authorization, 'tma ') === 0) {
        return trim(substr($authorization, 4));
    }

    return '';
}

function require_manager()
{
    $user = telegram_user_from_init(init_data_header());
    if (!$user) {
        json_out(array('ok' => false, 'error' => 'auth'), 401);
    }

    $statement = db()->prepare('SELECT telegram_id, name, role FROM allowed_users WHERE telegram_id = :id');
    $statement->execute(array('id' => (int) $user['id']));
    $manager = $statement->fetch();
    if (!$manager) {
        json_out(array('ok' => false, 'error' => 'denied'), 403);
    }

    return $manager;
}
