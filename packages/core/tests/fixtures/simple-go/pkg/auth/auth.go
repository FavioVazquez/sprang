package auth

type User struct {
	Username string
	Password string
}

type AuthError struct {
	Message string
}

func NewUser(username, password string) User {
	return User{Username: username, Password: password}
}

func Greet(u User) string {
	return "Hello, " + u.Username
}

func (e AuthError) Error() string {
	return e.Message
}
