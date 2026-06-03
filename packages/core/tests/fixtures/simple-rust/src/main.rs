mod auth;
mod models;

use crate::auth::authenticate;
use crate::models::User;

fn main() {
    let user = User::new("alice", "secret");
    if authenticate(&user) {
        println!("Welcome, {}!", user.name);
    }
}

pub fn run_app() -> Result<(), String> {
    main();
    Ok(())
}
