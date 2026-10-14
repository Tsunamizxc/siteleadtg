<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

function db()
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $driver = (string) app_config('driver', 'sqlite');
    if ($driver === 'mysql') {
        $pdo = db_mysql();
    } else {
        $pdo = db_sqlite();
    }

    db_migrate($pdo, $driver);
    return $pdo;
}

function db_sqlite()
{
    $path = (string) app_config('sqlite_path', dirname(__DIR__) . '/data/leads.sqlite');
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        json_out(array('ok' => false, 'error' => 'database'), 500);
    }

    $pdo = new PDO('sqlite:' . $path, null, null, array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ));
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 3000');
    $pdo->exec('PRAGMA foreign_keys = ON');
    return $pdo;
}

function db_mysql()
{
    $mysql = app_config('mysql', array());
    if (!is_array($mysql)) {
        $mysql = array();
    }

    $host = isset($mysql['host']) ? (string) $mysql['host'] : 'localhost';
    $name = isset($mysql['name']) ? (string) $mysql['name'] : 'cursiva_leads';
    $user = isset($mysql['user']) ? (string) $mysql['user'] : '';
    $pass = isset($mysql['pass']) ? (string) $mysql['pass'] : '';

    $options = array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    );

    try {
        $server = new PDO('mysql:host=' . $host . ';charset=utf8mb4', $user, $pass, $options);
        $server->exec('CREATE DATABASE IF NOT EXISTS `' . str_replace('`', '', $name) . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    } catch (Exception $error) {
        // Хостинг может запретить создание базы. Дальше пробуем подключиться к уже созданной.
    }

    return new PDO('mysql:host=' . $host . ';dbname=' . $name . ';charset=utf8mb4', $user, $pass, $options);
}

function db_migrate(PDO $pdo, $driver)
{
    if ($driver === 'mysql') {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS leads (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                attempt VARCHAR(80) NULL,
                name VARCHAR(160) NOT NULL DEFAULT "",
                phone VARCHAR(40) NOT NULL DEFAULT "",
                source VARCHAR(255) NOT NULL DEFAULT "",
                service VARCHAR(255) NOT NULL DEFAULT "",
                page VARCHAR(500) NOT NULL DEFAULT "",
                description TEXT NOT NULL,
                promo VARCHAR(80) NOT NULL DEFAULT "",
                messenger VARCHAR(80) NOT NULL DEFAULT "",
                city VARCHAR(160) NOT NULL DEFAULT "",
                form_type VARCHAR(40) NOT NULL DEFAULT "",
                traffic VARCHAR(80) NOT NULL DEFAULT "",
                status VARCHAR(20) NOT NULL DEFAULT "active",
                notified TINYINT NOT NULL DEFAULT 0,
                created_at INT UNSIGNED NOT NULL,
                updated_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY attempt_unique (attempt)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS managers (
                telegram_id BIGINT NOT NULL,
                chat_id BIGINT NOT NULL,
                name VARCHAR(160) NOT NULL DEFAULT "",
                created_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (telegram_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        db_migrate_access($pdo, 'mysql');
        db_migrate_office($pdo, 'mysql');
        return;
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt TEXT UNIQUE,
            name TEXT NOT NULL DEFAULT "",
            phone TEXT NOT NULL DEFAULT "",
            source TEXT NOT NULL DEFAULT "",
            service TEXT NOT NULL DEFAULT "",
            page TEXT NOT NULL DEFAULT "",
            description TEXT NOT NULL DEFAULT "",
            promo TEXT NOT NULL DEFAULT "",
            messenger TEXT NOT NULL DEFAULT "",
            city TEXT NOT NULL DEFAULT "",
            form_type TEXT NOT NULL DEFAULT "",
            traffic TEXT NOT NULL DEFAULT "",
            status TEXT NOT NULL DEFAULT "active",
            notified INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS managers (
            telegram_id INTEGER PRIMARY KEY,
            chat_id INTEGER NOT NULL,
            name TEXT NOT NULL DEFAULT "",
            created_at INTEGER NOT NULL
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS leads_status ON leads (status, created_at)');
    db_migrate_access($pdo, 'sqlite');
    db_migrate_office($pdo, 'sqlite');
}

function db_add_column(PDO $pdo, $driver, $table, $column, $definition)
{
    if ($driver === 'mysql') {
        $statement = $pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND COLUMN_NAME = :column_name'
        );
        $statement->execute(array(
            'table_name' => $table,
            'column_name' => $column,
        ));
        if ((int) $statement->fetchColumn() > 0) {
            return;
        }
        $pdo->exec('ALTER TABLE `' . $table . '` ADD COLUMN `' . $column . '` ' . $definition);
        return;
    }

    $columns = $pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll();
    foreach ($columns as $info) {
        if ((string) $info['name'] === $column) {
            return;
        }
    }
    $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
}

function db_migrate_access(PDO $pdo, $driver)
{
    db_add_column($pdo, $driver, 'leads', 'note', $driver === 'mysql' ? 'TEXT NULL' : 'TEXT NOT NULL DEFAULT ""');

    if ($driver === 'mysql') {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS allowed_users (
                telegram_id BIGINT NOT NULL,
                name VARCHAR(160) NOT NULL DEFAULT "",
                role VARCHAR(20) NOT NULL DEFAULT "member",
                created_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (telegram_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS chats (
                chat_id BIGINT NOT NULL,
                telegram_id BIGINT NOT NULL DEFAULT 0,
                title VARCHAR(255) NOT NULL DEFAULT "",
                kind VARCHAR(20) NOT NULL DEFAULT "private",
                created_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (chat_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    } else {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS allowed_users (
                telegram_id INTEGER PRIMARY KEY,
                name TEXT NOT NULL DEFAULT "",
                role TEXT NOT NULL DEFAULT "member",
                created_at INTEGER NOT NULL
            )'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS chats (
                chat_id INTEGER PRIMARY KEY,
                telegram_id INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL DEFAULT "",
                kind TEXT NOT NULL DEFAULT "private",
                created_at INTEGER NOT NULL
            )'
        );
    }

    $managers = $pdo->query('SELECT telegram_id, chat_id, name, created_at FROM managers')->fetchAll();
    $has_owner = (int) $pdo->query("SELECT COUNT(*) FROM allowed_users WHERE role = 'owner'")->fetchColumn() > 0;
    $insert_user = $pdo->prepare(
        'INSERT INTO allowed_users (telegram_id, name, role, created_at) VALUES (:telegram_id, :name, :role, :created_at)'
    );
    $insert_chat = $pdo->prepare(
        'INSERT INTO chats (chat_id, telegram_id, title, kind, created_at) VALUES (:chat_id, :telegram_id, :title, :kind, :created_at)'
    );

    foreach ($managers as $manager) {
        $telegram_id = (int) $manager['telegram_id'];
        $exists = $pdo->prepare('SELECT telegram_id FROM allowed_users WHERE telegram_id = :id');
        $exists->execute(array('id' => $telegram_id));
        if (!$exists->fetch()) {
            $role = $has_owner ? 'member' : 'owner';
            $has_owner = true;
            $insert_user->execute(array(
                'telegram_id' => $telegram_id,
                'name' => (string) $manager['name'],
                'role' => $role,
                'created_at' => (int) $manager['created_at'],
            ));
        }

        $chat_exists = $pdo->prepare('SELECT chat_id FROM chats WHERE chat_id = :id');
        $chat_exists->execute(array('id' => (int) $manager['chat_id']));
        if (!$chat_exists->fetch()) {
            $insert_chat->execute(array(
                'chat_id' => (int) $manager['chat_id'],
                'telegram_id' => $telegram_id,
                'title' => (string) $manager['name'],
                'kind' => 'private',
                'created_at' => (int) $manager['created_at'],
            ));
        }
    }
}

function db_migrate_office(PDO $pdo, $driver)
{
    if ($driver === 'mysql') {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS tasks (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                title VARCHAR(255) NOT NULL,
                details TEXT NOT NULL,
                done TINYINT NOT NULL DEFAULT 0,
                created_by BIGINT NOT NULL DEFAULT 0,
                created_at INT UNSIGNED NOT NULL,
                updated_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS work_projects (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                client VARCHAR(160) NOT NULL DEFAULT "",
                amount_cents BIGINT NOT NULL DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT "progress",
                created_by BIGINT NOT NULL DEFAULT 0,
                created_at INT UNSIGNED NOT NULL,
                updated_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS money_entries (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                kind VARCHAR(20) NOT NULL,
                amount_cents BIGINT NOT NULL,
                title VARCHAR(255) NOT NULL DEFAULT "",
                project_id INT UNSIGNED NULL,
                happened_on DATE NOT NULL,
                note TEXT NOT NULL,
                created_by BIGINT NOT NULL DEFAULT 0,
                created_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (id),
                KEY money_happened (happened_on),
                KEY money_project (project_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        return;
    }

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT "",
            done INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS work_projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            client TEXT NOT NULL DEFAULT "",
            amount_cents INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT "progress",
            created_by INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS money_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT "",
            project_id INTEGER,
            happened_on TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT "",
            created_by INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )'
    );
}
