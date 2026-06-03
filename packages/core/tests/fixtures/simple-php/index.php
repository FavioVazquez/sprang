<?php
require_once 'src/User.php';
require_once 'src/Auth.php';

function main(): void {
    $user = new User('alice', 'secret');
    $auth = new Auth();
    if ($auth->authenticate($user)) {
        echo greet($user->getName()) . "\n";
    }
}

function greet(string $name): string {
    return "Hello, $name!";
}

main();
