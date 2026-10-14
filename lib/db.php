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
}
