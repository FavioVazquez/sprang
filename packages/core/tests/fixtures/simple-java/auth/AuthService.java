package auth;

public class AuthService {
    private int maxAttempts = 3;

    public boolean authenticate(User user) {
        return user != null && !user.getPassword().isEmpty();
    }

    public String getToken(User user) {
        return "token-" + user.getName();
    }
}
