<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function money_cents($value)
{
    $raw = trim((string) $value);
    $raw = str_replace(array(' ', "\xc2\xa0", '₽', 'руб.', 'руб'), '', $raw);
    $raw = str_replace(',', '.', $raw);
    if (!preg_match('/^\d+(\.\d{1,2})?$/', $raw)) {
        return null;
    }

    $parts = explode('.', $raw, 2);
    $rubles = (int) $parts[0];
    $kopecks = isset($parts[1]) ? (int) str_pad(substr($parts[1], 0, 2), 2, '0') : 0;
    $cents = ($rubles * 100) + $kopecks;
    if ($cents < 1 || $cents > 100000000000) {
        return null;
    }

    return $cents;
}

function money_format_rub($amount)
{
    $cents = (int) round(((float) $amount) * 100);
    $sign = $cents < 0 ? '−' : '';
    $abs = abs($cents);
    $grouped = number_format((int) floor($abs / 100), 0, '', ' ');
    $kopecks = $abs % 100;
    if ($kopecks === 0) {
        return $sign . $grouped . ' ₽';
    }

    return $sign . $grouped . ',' . str_pad((string) $kopecks, 2, '0', STR_PAD_LEFT) . ' ₽';
}

function finance_seed()
{
    $raw = @file_get_contents(__DIR__ . '/finance-seed.json');
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (is_array($data)) {
        return $data;
    }

    return array(
        'rates' => array('RUB' => 1, 'USD' => 81.5, 'EUR' => 95.2),
        'selfEmployedTaxPercent' => 6,
        'employees' => array(),
        'clients' => array(),
        'projects' => array(),
        'invoices' => array(),
        'accounts' => array(),
        'transactions' => array(),
        'subscriptions' => array(),
        'taxPayments' => array(),
    );
}

function finance_empty(array $base)
{
    $accounts = array();
    foreach (isset($base['accounts']) && is_array($base['accounts']) ? $base['accounts'] : array() as $account) {
        $account['openingBalance'] = 0;
        $accounts[] = $account;
    }

    return array(
        'rates' => isset($base['rates']) ? $base['rates'] : array('RUB' => 1, 'USD' => 81.5, 'EUR' => 95.2),
        'selfEmployedTaxPercent' => isset($base['selfEmployedTaxPercent']) ? $base['selfEmployedTaxPercent'] : 6,
        'employees' => isset($base['employees']) && is_array($base['employees']) ? $base['employees'] : array(),
        'clients' => array(),
        'projects' => array(),
        'invoices' => array(),
        'accounts' => $accounts,
        'transactions' => array(),
        'subscriptions' => array(),
        'taxPayments' => array(),
    );
}

function finance_split($budget, $tax_percent, array $employees)
{
    $gross = (float) $budget;
    $tax_amount = round($gross * (float) $tax_percent / 100, 2);
    $net = round($gross - $tax_amount, 2);
    $active = array_values(array_filter($employees, function ($employee) {
        return !isset($employee['status']) || $employee['status'] !== 'inactive';
    }));
    $shares = array();
    $allocated = 0.0;
    foreach ($active as $index => $employee) {
        $percent = isset($employee['percent']) ? (float) $employee['percent'] : 0;
        if ($index === count($active) - 1) {
            $amount = round($net - $allocated, 2);
        } else {
            $amount = round($net * $percent / 100, 2);
            $allocated += $amount;
        }
        $shares[] = array('employeeId' => (string) $employee['id'], 'percent' => $percent, 'amount' => $amount);
    }

    return array('taxPercent' => (float) $tax_percent, 'taxAmount' => $tax_amount, 'netAmount' => $net, 'shares' => $shares);
}

function finance_project(array $data, $id, $name, $client_id, $status, $budget, $created)
{
    $split = finance_split($budget, $data['selfEmployedTaxPercent'], $data['employees']);
    return array(
        'id' => $id,
        'clientId' => $client_id,
        'name' => $name,
        'type' => 'other',
        'status' => $status,
        'budget' => (float) $budget,
        'currency' => 'RUB',
        'taxPercent' => $split['taxPercent'],
        'taxAmount' => $split['taxAmount'],
        'netAmount' => $split['netAmount'],
        'shares' => $split['shares'],
        'startDate' => $created,
        'dueDate' => $created,
        'notes' => '',
        'createdAt' => $created,
    );
}

function finance_legacy(array $data)
{
    $account = isset($data['accounts'][0]['id']) ? (string) $data['accounts'][0]['id'] : '';
    $statuses = array('progress' => 'in_progress', 'paused' => 'paused', 'done' => 'done');
    $clients = array();

    foreach (db()->query('SELECT * FROM work_projects ORDER BY id ASC')->fetchAll() as $row) {
        $client_id = '';
        $client = trim((string) $row['client']);
        if ($client !== '') {
            if (!isset($clients[$client])) {
                $clients[$client] = 'cl-old-' . (count($clients) + 1);
                $data['clients'][] = array(
                    'id' => $clients[$client],
                    'name' => $client,
                    'company' => $client,
                    'email' => '',
                    'phone' => '',
                    'city' => '',
                    'status' => 'active',
                    'createdAt' => date('Y-m-d', (int) $row['created_at']),
                );
            }
            $client_id = $clients[$client];
        }
        $status = isset($statuses[$row['status']]) ? $statuses[$row['status']] : 'in_progress';
        $data['projects'][] = finance_project(
            $data,
            'pr-old-' . (int) $row['id'],
            (string) $row['name'],
            $client_id,
            $status,
            ((int) $row['amount_cents']) / 100,
            date('Y-m-d', (int) $row['created_at'])
        );
    }

    foreach (db()->query('SELECT * FROM money_entries ORDER BY happened_on ASC, id ASC')->fetchAll() as $row) {
        $note = trim((string) $row['note']);
        $data['transactions'][] = array(
            'id' => 'tx-old-' . (int) $row['id'],
            'type' => (string) $row['kind'] === 'expense' ? 'expense' : 'income',
            'accountId' => $account,
            'projectId' => $row['project_id'] !== null ? 'pr-old-' . (int) $row['project_id'] : '',
            'category' => (string) $row['kind'] === 'expense' ? 'Расход' : 'Оплата',
            'amount' => ((int) $row['amount_cents']) / 100,
            'currency' => 'RUB',
            'date' => (string) $row['happened_on'],
            'counterparty' => '',
            'description' => trim((string) $row['title'] . ($note !== '' ? ' — ' . $note : '')),
        );
    }

    return $data;
}

function finance_row()
{
    $row = db()->query('SELECT data, rev FROM finance_state WHERE id = 1')->fetch();
    if ($row) {
        $data = json_decode((string) $row['data'], true);
        return array('data' => is_array($data) ? $data : finance_empty(finance_seed()), 'rev' => (int) $row['rev']);
    }

    $data = finance_legacy(finance_empty(finance_seed()));
    try {
        $statement = db()->prepare('INSERT INTO finance_state (id, data, rev, updated_by, updated_at) VALUES (1, :data, 1, 0, :now)');
        $statement->execute(array('data' => finance_encode($data), 'now' => time()));
    } catch (Exception $error) {
        return finance_row();
    }

    return array('data' => $data, 'rev' => 1);
}

function finance_encode(array $data)
{
    return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function finance_valid(array $data)
{
    foreach (array('clients', 'projects', 'employees') as $key) {
        if (!isset($data[$key]) || !is_array($data[$key])) {
            return false;
        }
    }
    return true;
}

function finance_state()
{
    $row = finance_row();
    return array('ok' => true, 'data' => $row['data'], 'rev' => $row['rev']);
}

function finance_write(array $data, $rev, $actor_id, $notice = '')
{
    if (!finance_valid($data)) {
        json_out(array('ok' => false, 'error' => 'data', 'message' => 'Данные финансов повреждены.'), 400);
    }
    $encoded = finance_encode($data);
    if (strlen($encoded) > 5000000) {
        json_out(array('ok' => false, 'error' => 'size', 'message' => 'Слишком много данных для сохранения.'), 413);
    }

    $previous = finance_row();
    $statement = db()->prepare(
        'UPDATE finance_state SET data = :data, rev = rev + 1, updated_by = :actor, updated_at = :now WHERE id = 1 AND rev = :rev'
    );
    $statement->execute(array('data' => $encoded, 'actor' => (int) $actor_id, 'now' => time(), 'rev' => (int) $rev));
    if ($statement->rowCount() > 0 && $notice !== null) {
        $lines = $notice !== '' ? array($notice) : finance_changes($previous['data'], $data);
        if ($lines) {
            if (count($lines) > 12) {
                $lines = array_merge(array_slice($lines, 0, 12), array('…и ещё ' . (count($lines) - 12)));
            }
            notify_team('💰 Финансы — ' . actor_name($actor_id) . ":\n" . implode("\n", $lines), $actor_id, 'finance');
        }
    }
    if ($statement->rowCount() < 1) {
        $current = finance_row();
        json_out(array(
            'ok' => false,
            'error' => 'conflict',
            'message' => 'Коллега только что изменил финансы. Показываю свежие данные — повторите действие.',
            'data' => $current['data'],
            'rev' => $current['rev'],
        ), 409);
    }

    return array('ok' => true, 'data' => $data, 'rev' => (int) $rev + 1);
}

function finance_save(array $input, $actor_id)
{
    $data = isset($input['data']) && is_array($input['data']) ? $input['data'] : array();
    return finance_write($data, isset($input['rev']) ? $input['rev'] : 0, $actor_id);
}

function finance_reset_demo($actor_id)
{
    $row = finance_row();
    return finance_write(finance_seed(), $row['rev'], $actor_id, 'загружены демо-данные');
}

function finance_clear($actor_id)
{
    $row = finance_row();
    $data = finance_empty($row['data']);
    $data['employees'] = array();
    return finance_write($data, $row['rev'], $actor_id, 'все данные удалены');
}

function finance_rub(array $item, array $rates)
{
    $currency = isset($item['currency']) ? (string) $item['currency'] : 'RUB';
    $rate = isset($rates[$currency]) ? (float) $rates[$currency] : 1;
    return (float) (isset($item['amount']) ? $item['amount'] : 0) * $rate;
}

function finance_summary()
{
    $row = finance_row();
    $data = $row['data'];
    $rates = isset($data['rates']) && is_array($data['rates']) ? $data['rates'] : array('RUB' => 1);
    $from = date('Y-m-01');
    $to = date('Y-m-t');
    $month = array('income' => 0.0, 'expense' => 0.0);
    $all = array('income' => 0.0, 'expense' => 0.0);
    $balances = array();

    foreach (isset($data['transactions']) ? $data['transactions'] : array() as $tx) {
        $type = isset($tx['type']) && $tx['type'] === 'expense' ? 'expense' : 'income';
        $rub = finance_rub($tx, $rates);
        $all[$type] += $rub;
        $date = isset($tx['date']) ? (string) $tx['date'] : '';
        if ($date >= $from && $date <= $to) {
            $month[$type] += $rub;
        }
        $account = isset($tx['accountId']) ? (string) $tx['accountId'] : '';
        $balances[$account] = (isset($balances[$account]) ? $balances[$account] : 0) + ($type === 'income' ? $rub : -$rub);
    }

    $cash = 0.0;
    foreach (isset($data['accounts']) ? $data['accounts'] : array() as $account) {
        $opening = array('amount' => isset($account['openingBalance']) ? $account['openingBalance'] : 0, 'currency' => isset($account['currency']) ? $account['currency'] : 'RUB');
        $cash += finance_rub($opening, $rates);
        $id = isset($account['id']) ? (string) $account['id'] : '';
        $cash += isset($balances[$id]) ? $balances[$id] : 0;
    }

    $progress_count = 0;
    $progress_sum = 0.0;
    foreach (isset($data['projects']) ? $data['projects'] : array() as $project) {
        $status = isset($project['status']) ? (string) $project['status'] : '';
        if ($status === 'in_progress' || $status === 'review') {
            $progress_count += 1;
            $progress_sum += finance_rub(array(
                'amount' => isset($project['budget']) ? $project['budget'] : 0,
                'currency' => isset($project['currency']) ? $project['currency'] : 'RUB',
            ), $rates);
        }
    }

    $months = array(
        1 => 'январь', 2 => 'февраль', 3 => 'март', 4 => 'апрель',
        5 => 'май', 6 => 'июнь', 7 => 'июль', 8 => 'август',
        9 => 'сентябрь', 10 => 'октябрь', 11 => 'ноябрь', 12 => 'декабрь',
    );

    return array(
        'ok' => true,
        'month_label' => $months[(int) date('n')],
        'month' => array(
            'income_label' => money_format_rub($month['income']),
            'expense_label' => money_format_rub($month['expense']),
            'profit_label' => money_format_rub($month['income'] - $month['expense']),
        ),
        'all' => array('profit_label' => money_format_rub($all['income'] - $all['expense'])),
        'cash_label' => money_format_rub($cash),
        'progress_count' => $progress_count,
        'progress_label' => money_format_rub($progress_sum),
    );
}

function finance_add_money(array $input, $actor_id)
{
    $kind = isset($input['kind']) && $input['kind'] === 'expense' ? 'expense' : 'income';
    $cents = money_cents(isset($input['amount']) ? $input['amount'] : '');
    if ($cents === null) {
        json_out(array('ok' => false, 'error' => 'amount', 'message' => 'Сумма должна быть больше нуля, например 15000.'), 400);
    }
    $title = clip_text(isset($input['title']) ? $input['title'] : '', 255);

    for ($attempt = 0; $attempt < 3; $attempt++) {
        $row = finance_row();
        $data = $row['data'];
        $data['transactions'] = isset($data['transactions']) && is_array($data['transactions']) ? $data['transactions'] : array();
        $data['transactions'][] = array(
            'id' => 'tx-' . bin2hex(random_bytes(4)),
            'type' => $kind,
            'accountId' => isset($data['accounts'][0]['id']) ? (string) $data['accounts'][0]['id'] : '',
            'projectId' => '',
            'category' => $kind === 'income' ? 'Оплата' : 'Расход',
            'amount' => $cents / 100,
            'currency' => 'RUB',
            'date' => date('Y-m-d'),
            'counterparty' => '',
            'description' => $title,
        );
        $statement = db()->prepare(
            'UPDATE finance_state SET data = :data, rev = rev + 1, updated_by = :actor, updated_at = :now WHERE id = 1 AND rev = :rev'
        );
        $statement->execute(array('data' => finance_encode($data), 'actor' => (int) $actor_id, 'now' => time(), 'rev' => $row['rev']));
        if ($statement->rowCount() > 0) {
            notify_team(
                '💰 ' . actor_name($actor_id) . ': ' . ($kind === 'income' ? 'доход ' : 'расход ') . money_format_rub($cents / 100) . ($title !== '' ? ' — ' . $title : ''),
                $actor_id,
                'finance',
                isset($input['chat_id']) ? (int) $input['chat_id'] : 0
            );
            $summary = finance_summary();
            $summary['message'] = ($kind === 'income' ? 'Доход ' : 'Расход ') . money_format_rub($cents / 100) . ' записан.';
            return $summary;
        }
    }

    json_out(array('ok' => false, 'error' => 'busy', 'message' => 'Финансы сейчас меняют, попробуйте ещё раз.'), 409);
}
