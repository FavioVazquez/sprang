using Auth;
using System;

class Program {
    public static void Main(string[] args) {
        var user = new UserModel("alice", "secret");
        var auth = new AuthService();
        if (auth.Authenticate(user)) {
            Console.WriteLine(Greet(user.Name));
        }
    }

    public static string Greet(string name) {
        return $"Hello, {name}!";
    }
}
