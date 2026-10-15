<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function actor_name($telegram_id)
{
    $statement = db()->prepare('SELECT name FROM allowed_users WHERE telegram_id = :id');
    $statement->execute(array('id' => (int) $telegram_id));
    $name = trim((string) $statement->fetchColumn());
    return $name !== '' ? $name : 'Участник';
}

function notify_team($text, $actor_id, $page = '', $skip_chat = 0)
{
    $text = clip_text($text, 3500);
    if ($text === '') {
        return;
    }

    $insert = db()->prepare(
        'INSERT INTO notify_outbox (chat_id, text, page, created_at) VALUES (:chat_id, :text, :page, :created_at)'
    );
    foreach (db()->query('SELECT chat_id FROM chats')->fetchAll() as $chat) {
        $chat_id = (int) $chat['chat_id'];
        if ($chat_id === (int) $skip_chat || $chat_id === (int) $actor_id) {
            continue;
        }
        $insert->execute(array(
            'chat_id' => $chat_id,
            'text' => $text,
            'page' => (string) $page,
            'created_at' => time(),
        ));
    }
}

function notify_pending()
{
    $old = db()->prepare('DELETE FROM notify_outbox WHERE created_at < :limit');
    $old->execute(array('limit' => time() - 172800));

    $items = array();
    foreach (db()->query('SELECT * FROM notify_outbox ORDER BY id ASC LIMIT 40')->fetchAll() as $row) {
        $items[] = array(
            'id' => (int) $row['id'],
            'chat_id' => (int) $row['chat_id'],
            'text' => (string) $row['text'],
            'page' => (string) $row['page'],
        );
    }
    return array('ok' => true, 'items' => $items);
}

function notify_ack(array $ids)
{
    $statement = db()->prepare('DELETE FROM notify_outbox WHERE id = :id');
    foreach ($ids as $id) {
        $statement->execute(array('id' => (int) $id));
    }
    return array('ok' => true);
}

function finance_label_of(array $item)
{
    foreach (array('company', 'number', 'name', 'description', 'category') as $key) {
        if (!empty($item[$key])) {
            return (string) $item[$key];
        }
    }
    return '';
}

function finance_by_id($list)
{
    $map = array();
    foreach (is_array($list) ? $list : array() as $item) {
        if (is_array($item) && isset($item['id'])) {
            $map[(string) $item['id']] = $item;
        }
    }
    return $map;
}

function finance_changes(array $old, array $new)
{
    $lines = array();
    $collections = array(
        'transactions' => 'движение',
        'projects' => 'проект',
        'invoices' => 'счёт',
        'clients' => 'клиент',
        'subscriptions' => 'подписка',
        'employees' => 'сотрудник',
        'taxPayments' => 'платёж НПД',
        'accounts' => 'касса',
    );
    $project_statuses = array('lead' => 'лид', 'in_progress' => 'в работе', 'review' => 'согласование', 'done' => 'сдан', 'paused' => 'пауза');

    foreach ($collections as $key => $label) {
        $before = finance_by_id(isset($old[$key]) ? $old[$key] : array());
        $after = finance_by_id(isset($new[$key]) ? $new[$key] : array());

        foreach ($after as $id => $item) {
            if (isset($before[$id])) {
                continue;
            }
            if ($key === 'transactions') {
                $sign = isset($item['type']) && $item['type'] === 'expense' ? 'Расход' : 'Доход';
                $what = trim((string) (isset($item['description']) && $item['description'] !== '' ? $item['description'] : (isset($item['category']) ? $item['category'] : '')));
                $lines[] = '+ ' . $sign . ' ' . money_format_rub(finance_rub($item, isset($new['rates']) ? $new['rates'] : array())) . ($what !== '' ? ' — ' . $what : '');
            } else {
                $lines[] = '+ ' . $label . ' «' . finance_label_of($item) . '»';
            }
        }

        $removed = array_diff_key($before, $after);
        if ($removed) {
            $names = array();
            foreach (array_slice($removed, 0, 3) as $item) {
                $names[] = '«' . finance_label_of($item) . '»';
            }
            $lines[] = '− удалено (' . $label . '): ' . implode(', ', $names) . (count($removed) > 3 ? ' и ещё ' . (count($removed) - 3) : '');
        }

        if ($key === 'projects') {
            foreach ($after as $id => $item) {
                if (isset($before[$id]['status'], $item['status']) && $before[$id]['status'] !== $item['status']) {
                    $status = isset($project_statuses[$item['status']]) ? $project_statuses[$item['status']] : $item['status'];
                    $lines[] = 'Проект «' . finance_label_of($item) . '»: ' . $status;
                }
            }
        }
        if ($key === 'invoices') {
            foreach ($after as $id => $item) {
                if (isset($before[$id]['status'], $item['status']) && $before[$id]['status'] !== $item['status'] && $item['status'] === 'paid') {
                    $lines[] = 'Счёт ' . finance_label_of($item) . ' оплачен';
                }
            }
        }
    }

    if (isset($old['selfEmployedTaxPercent'], $new['selfEmployedTaxPercent']) && (float) $old['selfEmployedTaxPercent'] !== (float) $new['selfEmployedTaxPercent']) {
        $lines[] = 'НПД теперь ' . $new['selfEmployedTaxPercent'] . '%';
    }

    return $lines;
}
