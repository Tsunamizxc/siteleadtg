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

function money_format_cents($cents)
{
    $cents = (int) $cents;
    $sign = $cents < 0 ? '−' : '';
    $abs = abs($cents);
    $rubles = (int) floor($abs / 100);
    $kopecks = $abs % 100;
    $grouped = number_format($rubles, 0, '', ' ');
    if ($kopecks === 0) {
        return $sign . $grouped . ' ₽';
    }

    return $sign . $grouped . ',' . str_pad((string) $kopecks, 2, '0', STR_PAD_LEFT) . ' ₽';
}

function project_statuses()
{
    return array('progress', 'paused', 'done');
}

function project_status_label($status)
{
    $labels = array(
        'progress' => 'в работе',
        'paused' => 'пауза',
        'done' => 'завершён',
    );

    return isset($labels[$status]) ? $labels[$status] : $status;
}

function project_present(array $row)
{
    return array(
        'id' => (int) $row['id'],
        'name' => (string) $row['name'],
        'client' => (string) $row['client'],
        'amount_cents' => (int) $row['amount_cents'],
        'amount_label' => money_format_cents((int) $row['amount_cents']),
        'status' => (string) $row['status'],
        'status_label' => project_status_label($row['status']),
    );
}

function money_present(array $row)
{
    $happened = (string) $row['happened_on'];
    $stamp = strtotime($happened . ' 12:00:00');

    return array(
        'id' => (int) $row['id'],
        'kind' => (string) $row['kind'],
        'amount_cents' => (int) $row['amount_cents'],
        'amount_label' => money_format_cents((int) $row['amount_cents']),
        'title' => (string) $row['title'],
        'project_id' => $row['project_id'] !== null ? (int) $row['project_id'] : 0,
        'project_name' => isset($row['project_name']) ? (string) $row['project_name'] : '',
        'happened_on' => $happened,
        'happened_label' => $stamp ? format_moment($stamp) : $happened,
        'note' => (string) $row['note'],
    );
}

function finance_totals($from_date)
{
    $sql = 'SELECT kind, COALESCE(SUM(amount_cents), 0) AS total FROM money_entries';
    $params = array();
    if ($from_date !== '') {
        $sql .= ' WHERE happened_on >= :from_date';
        $params['from_date'] = $from_date;
    }
    $sql .= ' GROUP BY kind';
    $statement = db()->prepare($sql);
    $statement->execute($params);
    $income = 0;
    $expense = 0;
    foreach ($statement->fetchAll() as $row) {
        if ($row['kind'] === 'income') {
            $income = (int) $row['total'];
        }
        if ($row['kind'] === 'expense') {
            $expense = (int) $row['total'];
        }
    }

    return array(
        'income' => $income,
        'expense' => $expense,
        'profit' => $income - $expense,
        'income_label' => money_format_cents($income),
        'expense_label' => money_format_cents($expense),
        'profit_label' => money_format_cents($income - $expense),
    );
}

function finance_snapshot()
{
    $month_start = date('Y-m-01');
    $projects = array();
    $progress_cents = 0;
    $progress_count = 0;
    foreach (db()->query('SELECT * FROM work_projects ORDER BY updated_at DESC, id DESC')->fetchAll() as $row) {
        $project = project_present($row);
        if ($project['status'] === 'progress') {
            $progress_count += 1;
            $progress_cents += $project['amount_cents'];
        }
        $projects[] = $project;
    }

    $entries = array();
    $statement = db()->query(
        'SELECT money_entries.*, work_projects.name AS project_name
         FROM money_entries
         LEFT JOIN work_projects ON work_projects.id = money_entries.project_id
         ORDER BY money_entries.happened_on DESC, money_entries.id DESC
         LIMIT 80'
    );
    foreach ($statement->fetchAll() as $row) {
        $entries[] = money_present($row);
    }

    $months = array(
        1 => 'январь', 2 => 'февраль', 3 => 'март', 4 => 'апрель',
        5 => 'май', 6 => 'июнь', 7 => 'июль', 8 => 'август',
        9 => 'сентябрь', 10 => 'октябрь', 11 => 'ноябрь', 12 => 'декабрь',
    );
    $month_number = (int) date('n');

    return array(
        'ok' => true,
        'month_label' => isset($months[$month_number]) ? $months[$month_number] : '',
        'month' => finance_totals($month_start),
        'all' => finance_totals(''),
        'progress_count' => $progress_count,
        'progress_cents' => $progress_cents,
        'progress_label' => money_format_cents($progress_cents),
        'projects' => $projects,
        'entries' => $entries,
    );
}

function money_add(array $input, $actor_id)
{
    $kind = isset($input['kind']) ? (string) $input['kind'] : '';
    if ($kind !== 'income' && $kind !== 'expense') {
        json_out(array('ok' => false, 'error' => 'kind', 'message' => 'Укажите доход или расход.'), 400);
    }

    $cents = money_cents(isset($input['amount']) ? $input['amount'] : '');
    if ($cents === null) {
        json_out(array('ok' => false, 'error' => 'amount', 'message' => 'Сумма должна быть больше нуля, например 15000.'), 400);
    }

    $title = clip_text(isset($input['title']) ? $input['title'] : '', 255);
    if ($title === '') {
        $title = $kind === 'income' ? 'Доход' : 'Расход';
    }

    $happened = isset($input['happened_on']) ? trim((string) $input['happened_on']) : '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $happened)) {
        $happened = date('Y-m-d');
    }

    $project_id = isset($input['project_id']) ? (int) $input['project_id'] : 0;
    if ($project_id > 0) {
        $exists = db()->prepare('SELECT id FROM work_projects WHERE id = :id');
        $exists->execute(array('id' => $project_id));
        if (!$exists->fetch()) {
            $project_id = 0;
        }
    }

    $statement = db()->prepare(
        'INSERT INTO money_entries (kind, amount_cents, title, project_id, happened_on, note, created_by, created_at)
         VALUES (:kind, :amount_cents, :title, :project_id, :happened_on, :note, :created_by, :created_at)'
    );
    $statement->execute(array(
        'kind' => $kind,
        'amount_cents' => $cents,
        'title' => $title,
        'project_id' => $project_id > 0 ? $project_id : null,
        'happened_on' => $happened,
        'note' => clip_text(isset($input['note']) ? $input['note'] : '', 2000),
        'created_by' => (int) $actor_id,
        'created_at' => time(),
    ));

    $snapshot = finance_snapshot();
    $snapshot['message'] = ($kind === 'income' ? 'Доход ' : 'Расход ') . money_format_cents($cents) . ' записан.';
    return $snapshot;
}

function money_delete($id)
{
    $statement = db()->prepare('DELETE FROM money_entries WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
    if ($statement->rowCount() < 1) {
        json_out(array('ok' => false, 'error' => 'entry', 'message' => 'Запись не найдена.'), 404);
    }

    return finance_snapshot();
}

function project_save(array $input, $actor_id)
{
    $name = clip_text(isset($input['name']) ? $input['name'] : '', 255);
    if ($name === '') {
        json_out(array('ok' => false, 'error' => 'name', 'message' => 'Напишите название проекта.'), 400);
    }

    $status = isset($input['status']) ? (string) $input['status'] : 'progress';
    if (!in_array($status, project_statuses(), true)) {
        $status = 'progress';
    }

    $amount_raw = trim((string) (isset($input['amount']) ? $input['amount'] : ''));
    $amount = money_cents($amount_raw === '' ? '0' : $amount_raw);
    if ($amount === null) {
        $normalized = str_replace(array(' ', "\xc2\xa0", ','), array('', '', '.'), $amount_raw);
        if ($amount_raw === '' || preg_match('/^0+(\.0+)?$/', $normalized)) {
            $amount = 0;
        } else {
            json_out(array('ok' => false, 'error' => 'amount', 'message' => 'Сумма проекта указана неверно.'), 400);
        }
    }

    $client = clip_text(isset($input['client']) ? $input['client'] : '', 160);
    $now = time();
    $id = isset($input['id']) ? (int) $input['id'] : 0;

    if ($id > 0) {
        $current = db()->prepare('SELECT id FROM work_projects WHERE id = :id');
        $current->execute(array('id' => $id));
        if (!$current->fetch()) {
            json_out(array('ok' => false, 'error' => 'project', 'message' => 'Проект не найден.'), 404);
        }
        $statement = db()->prepare(
            'UPDATE work_projects
             SET name = :name, client = :client, amount_cents = :amount_cents, status = :status, updated_at = :updated_at
             WHERE id = :id'
        );
        $statement->execute(array(
            'name' => $name,
            'client' => $client,
            'amount_cents' => $amount,
            'status' => $status,
            'updated_at' => $now,
            'id' => $id,
        ));
    } else {
        $statement = db()->prepare(
            'INSERT INTO work_projects (name, client, amount_cents, status, created_by, created_at, updated_at)
             VALUES (:name, :client, :amount_cents, :status, :created_by, :created_at, :updated_at)'
        );
        $statement->execute(array(
            'name' => $name,
            'client' => $client,
            'amount_cents' => $amount,
            'status' => $status,
            'created_by' => (int) $actor_id,
            'created_at' => $now,
            'updated_at' => $now,
        ));
    }

    return finance_snapshot();
}

function project_delete($id)
{
    $clear = db()->prepare('UPDATE money_entries SET project_id = NULL WHERE project_id = :id');
    $clear->execute(array('id' => (int) $id));
    $statement = db()->prepare('DELETE FROM work_projects WHERE id = :id');
    $statement->execute(array('id' => (int) $id));
    if ($statement->rowCount() < 1) {
        json_out(array('ok' => false, 'error' => 'project', 'message' => 'Проект не найден.'), 404);
    }

    return finance_snapshot();
}
