<?php

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/telegram.php';
require __DIR__ . '/lib/leads.php';
require __DIR__ . '/lib/access.php';
require __DIR__ . '/lib/tasks.php';
require __DIR__ . '/lib/finance.php';

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

    if ($action === 'note' && $method === 'POST') {
        require_manager();
        $body = read_json();
        json_out(leads_set_note(
            isset($body['id']) ? (int) $body['id'] : 0,
            isset($body['note']) ? (string) $body['note'] : ''
        ));
    }

    if ($action === 'bootstrap' && $method === 'POST') {
        require_bot();
        $body = read_json();
        $owner = allowed_ensure_owner(
            isset($body['owner_id']) ? $body['owner_id'] : 0,
            isset($body['name']) ? $body['name'] : ''
        );
        json_out(array(
            'ok' => true,
            'owner' => $owner ? (int) $owner['telegram_id'] : 0,
            'count' => allowed_count(),
            'users' => allowed_list(),
        ));
    }

    if ($action === 'session' && $method === 'POST') {
        require_bot();
        json_out(session_open(read_json()));
    }

    if ($action === 'allow' && $method === 'POST') {
        require_bot();
        $body = read_json();
        json_out(allowed_add(
            isset($body['telegram_id']) ? $body['telegram_id'] : 0,
            isset($body['name']) ? $body['name'] : '',
            isset($body['actor_id']) ? $body['actor_id'] : 0,
            isset($body['max_users']) ? $body['max_users'] : 5
        ));
    }

    if ($action === 'deny' && $method === 'POST') {
        require_bot();
        $body = read_json();
        json_out(allowed_remove(
            isset($body['telegram_id']) ? $body['telegram_id'] : 0,
            isset($body['actor_id']) ? $body['actor_id'] : 0
        ));
    }

    if ($action === 'users' && $method === 'GET') {
        require_bot();
        json_out(array('ok' => true, 'users' => allowed_list(), 'count' => allowed_count()));
    }

    if ($action === 'chat' && $method === 'POST') {
        require_bot();
        $body = read_json();
        $actor = allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(chats_save(
            isset($body['chat_id']) ? $body['chat_id'] : 0,
            $actor['telegram_id'],
            isset($body['title']) ? $body['title'] : '',
            isset($body['kind']) ? $body['kind'] : 'group'
        ));
    }

    if ($action === 'chat_remove' && $method === 'POST') {
        require_bot();
        $body = read_json();
        json_out(chats_remove(isset($body['chat_id']) ? $body['chat_id'] : 0));
    }

    if ($action === 'leads_bot' && $method === 'GET') {
        require_bot();
        json_out(leads_list(isset($_GET['status']) ? (string) $_GET['status'] : ''));
    }

    if ($action === 'status_bot' && $method === 'POST') {
        require_bot();
        $body = read_json();
        allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(leads_set_status(
            isset($body['id']) ? (int) $body['id'] : 0,
            isset($body['status']) ? (string) $body['status'] : ''
        ));
    }

    if ($action === 'note_bot' && $method === 'POST') {
        require_bot();
        $body = read_json();
        allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(leads_set_note(
            isset($body['id']) ? (int) $body['id'] : 0,
            isset($body['note']) ? (string) $body['note'] : ''
        ));
    }

    if ($action === 'lead_manual' && $method === 'POST') {
        $manager = require_manager();
        json_out(leads_create_manual(read_json()));
    }

    if ($action === 'lead_manual_bot' && $method === 'POST') {
        require_bot();
        $body = read_json();
        $actor = allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(leads_create_manual($body));
    }

    if ($action === 'tasks' && $method === 'GET') {
        require_manager();
        json_out(tasks_list());
    }

    if ($action === 'task' && $method === 'POST') {
        $manager = require_manager();
        json_out(tasks_add(read_json(), $manager['telegram_id']));
    }

    if ($action === 'task_update' && $method === 'POST') {
        require_manager();
        json_out(tasks_update(read_json()));
    }

    if ($action === 'task_delete' && $method === 'POST') {
        require_manager();
        $body = read_json();
        json_out(tasks_delete(isset($body['id']) ? $body['id'] : 0));
    }

    if ($action === 'tasks_bot' && $method === 'GET') {
        require_bot();
        allowed_require_actor(isset($_GET['actor_id']) ? $_GET['actor_id'] : 0);
        json_out(tasks_list());
    }

    if ($action === 'task_bot' && $method === 'POST') {
        require_bot();
        $body = read_json();
        $actor = allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(tasks_add($body, $actor['telegram_id']));
    }

    if ($action === 'task_update_bot' && $method === 'POST') {
        require_bot();
        $body = read_json();
        allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(tasks_update($body));
    }

    if ($action === 'finance' && $method === 'GET') {
        require_manager();
        json_out(finance_snapshot());
    }

    if ($action === 'money' && $method === 'POST') {
        $manager = require_manager();
        json_out(money_add(read_json(), $manager['telegram_id']));
    }

    if ($action === 'money_delete' && $method === 'POST') {
        require_manager();
        $body = read_json();
        json_out(money_delete(isset($body['id']) ? $body['id'] : 0));
    }

    if ($action === 'project' && $method === 'POST') {
        $manager = require_manager();
        json_out(project_save(read_json(), $manager['telegram_id']));
    }

    if ($action === 'project_delete' && $method === 'POST') {
        require_manager();
        $body = read_json();
        json_out(project_delete(isset($body['id']) ? $body['id'] : 0));
    }

    if ($action === 'finance_bot' && $method === 'GET') {
        require_bot();
        allowed_require_actor(isset($_GET['actor_id']) ? $_GET['actor_id'] : 0);
        json_out(finance_snapshot());
    }

    if ($action === 'money_bot' && $method === 'POST') {
        require_bot();
        $body = read_json();
        $actor = allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(money_add($body, $actor['telegram_id']));
    }

    if ($action === 'project_bot' && $method === 'POST') {
        require_bot();
        $body = read_json();
        $actor = allowed_require_actor(isset($body['actor_id']) ? $body['actor_id'] : 0);
        json_out(project_save($body, $actor['telegram_id']));
    }

    json_out(array('ok' => false, 'error' => 'unknown'), 404);
} catch (Exception $error) {
    json_out(array('ok' => false, 'error' => 'server'), 500);
}
