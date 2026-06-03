package auth

class AuthService {
    fun authenticate(user: User): Boolean {
        return user.password.isNotEmpty()
    }

    suspend fun getTokenAsync(user: User): String {
        return "token-${user.name}"
    }
}
