<?php
require_once 'User.php';

class Auth {
    public function authenticate(User $user): bool {
        return strlen($user->getPassword()) > 0;
    }

    public function generateToken(User $user): string {
        return 'token-' . $user->getName();
    }
}
