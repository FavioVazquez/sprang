use crate::models::User;

pub struct AuthConfig {
    pub max_attempts: u32,
}

pub fn authenticate(user: &User) -> bool {
    !user.password.is_empty()
}

pub async fn authenticate_async(user: &User) -> bool {
    authenticate(user)
}
