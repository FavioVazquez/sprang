import auth.AuthService;
import auth.User;

public class Main {
    public static void main(String[] args) {
        User user = new User("alice", "secret");
        AuthService auth = new AuthService();
        if (auth.authenticate(user)) {
            System.out.println("Welcome, " + user.getName());
        }
    }

    public static String formatMessage(String name) {
        return "Hello, " + name + "!";
    }
}
