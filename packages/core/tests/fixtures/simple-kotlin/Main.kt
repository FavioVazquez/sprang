import auth.AuthService
import auth.User

fun main() {
    val user = User("alice", "secret")
    val auth = AuthService()
    if (auth.authenticate(user)) {
        println(greet(user.name))
    }
}

fun greet(name: String): String {
    return "Hello, $name!"
}
