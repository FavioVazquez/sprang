from utils import greet, format_name
from models.user import User
import os

def main():
    user = User(name="Alice", email="alice@example.com")
    msg = greet(user.name)
    print(msg)

async def fetch_data(url: str) -> str:
    return url

if __name__ == "__main__":
    main()
