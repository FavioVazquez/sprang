pub struct User {
    pub name: String,
    pub password: String,
}

pub enum Role {
    Admin,
    User,
    Guest,
}

impl User {
    pub fn new(name: &str, password: &str) -> Self {
        User { name: name.to_string(), password: password.to_string() }
    }
}
