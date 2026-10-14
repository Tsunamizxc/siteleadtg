<?php

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/telegram.php';
require __DIR__ . '/lib/leads.php';

$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
$method = isset($_SERVER['REQUEST_METHOD']) ? (string) $_SERVER['REQUEST_METHOD'] : 'GET';

try {
    if ($action === 'health') {
        db();
        json_out(array(
            'ok' => true,
            'driver' => (string) app_config('driver', 'sqlite'),
        ));
    }

    if ($action === 'lead' && $method === 'POST') {
        require_lead_secret();
        json_out(leads_create(read_json()));
    }

    if ($action === 'manager' && $method === 'POST') {
        require_bot();
        json_out(managers_save(read_json()));
    }

    if ($action === 'manager_remove' && $method === 'POST') {
        require_bot();
        $body = read_json();
        json_out(managers_remove(isset($body['telegram_id']) ? $body['telegram_id'] : 0));
    }

    if ($action === 'pending' && $method === 'GET') {
        require_bot();
        json_out(leads_pending());
    }

    if ($action === 'ack' && $method === 'POST') {
        require_bot();
        $body = read_json();
        $ids = isset($body['ids']) && is_array($body['ids']) ? $body['ids'] : array();
        json_out(leads_ack($ids));
    }

    if ($action === 'leads' && $method === 'GET') {
        require_manager();
        $status = isset($_GET['status']) ? (string) $_GET['status'] : '';
        json_out(leads_list($status));
    }

    if ($action === 'status' && $method === 'POST') {
        require_manager();
        $body = read_json();
        json_out(leads_set_status(
            isset($body['id']) ? (int) $body['id'] : 0,
            isset($body['status']) ? (string) $body['status'] : ''
        ));
    }

    json_out(array('ok' => false, 'error' => 'unknown'), 404);
} catch (Exception $error) {
    json_out(array('ok' => false, 'error' => 'server'), 500);
}
