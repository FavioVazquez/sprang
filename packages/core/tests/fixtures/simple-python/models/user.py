class User:
    def __init__(self, name: str, email: str):
        self.name = name
        self.email = email

    def display(self) -> str:
        return f"{self.name} <{self.email}>"

class AdminUser(User):
    def __init__(self, name: str, email: str, role: str = "admin"):
        super().__init__(name, email)
        self.role = role
