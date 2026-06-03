namespace Auth;

public class AuthService {
    public bool Authenticate(UserModel user) {
        return !string.IsNullOrEmpty(user.Password);
    }

    public async Task<string> GetTokenAsync(UserModel user) {
        return await Task.FromResult("token-" + user.Name);
    }
}
