package auth

data class User(
    val name: String,
    val password: String
)

interface Identifiable {
    fun getId(): String
}
