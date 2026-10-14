<?php

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'])) {
    http_response_code(404);
    exit;
}

$config = require dirname(__DIR__) . '/config.php';

if (!is_array($config)) {
    $config = array();
}

date_default_timezone_set(isset($config['timezone']) ? (string) $config['timezone'] : 'Asia/Omsk');

function app_config($key, $default = null)
{
    global $config;
    return array_key_exists($key, $config) ? $config[$key] : $default;
}

function json_out($payload, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function read_json()
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || $raw === '') {
        return array();
    }

    $data = json_decode($raw, true);
    return is_array($data) ? $data : array();
}

function header_value($name)
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$key]) ? (string) $_SERVER[$key] : '';
}

function secret_ok($provided, $expected)
{
    $provided = (string) $provided;
    $expected = (string) $expected;
    if ($expected === '' || $provided === '') {
        return false;
    }

    return hash_equals($expected, $provided);
}

function clip_text($value, $limit)
{
    $value = trim((string) $value);
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $limit);
    }

    return substr($value, 0, $limit);
}

function h($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}
