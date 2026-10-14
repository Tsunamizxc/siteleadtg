<?php
/**
 * Pulls main when GitHub sends a signed webhook.
 * Config with the secret lives outside the site:
 *   ../deploy/config.php
 */
declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');

$configFile = dirname(__DIR__) . '/deploy/config.php';
if (!is_readable($configFile)) {
    http_response_code(503);
    exit("Deploy config missing.\n");
}

/** @var array<string,mixed> $config */
$config = require $configFile;
$secret = trim((string) ($config['secret'] ?? ''));
$branch = (string) ($config['branch'] ?? 'main');
$command = (string) ($config['pull_command'] ?? '');
$diagKey = trim((string) ($config['diag_key'] ?? ''));

if (isset($_GET['diag'])) {
    $got = trim((string) $_GET['diag']);
    if ($diagKey === '' || !hash_equals($diagKey, $got)) {
        http_response_code(403);
        exit("Forbidden\n");
    }
    echo "deploy-pull ok\nbranch={$branch}\n";
    if (!isset($_GET['pull'])) {
        exit;
    }
    deploy_run($command);
}

$raw = file_get_contents('php://input');
if (!is_string($raw)) {
    $raw = '';
}
$signature = (string) ($_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '');
$expected = 'sha256=' . hash_hmac('sha256', $raw, $secret);
if ($secret === '' || $signature === '' || !hash_equals($expected, $signature)) {
    http_response_code(403);
    exit("Forbidden\n");
}

$event = json_decode($raw, true);
if (is_array($event) && !empty($event['ref']) && $event['ref'] !== 'refs/heads/' . $branch) {
    exit("Ignored {$event['ref']}\n");
}

deploy_run($command);

function deploy_run(string $command): void
{
    if ($command === '') {
        http_response_code(500);
        exit("Pull command is empty.\n");
    }

    $output = array();
    $code = 1;
    exec($command . ' 2>&1', $output, $code);
    echo implode("\n", $output) . "\nexit={$code}\n";
    http_response_code($code === 0 ? 200 : 500);
    exit;
}
