<?php

return array(
	'bot_token'   => '',
	'lead_secret' => '',
	'bot_secret'  => '',
	'web_app_url' => 'https://cursivalead.cursiva-dev.ru/',
	'timezone'    => 'Asia/Omsk',
	'driver'      => 'sqlite',
	'sqlite_path' => __DIR__ . '/data/leads.sqlite',
	'mysql'       => array(
		'host' => 'localhost',
		'name' => 'cursiva_leads',
		'user' => '',
		'pass' => '',
	),
);
