def greet(name: str) -> str:
    return f"Hello, {name}!"

def format_name(first: str, last: str) -> str:
    return f"{first} {last}".strip()

def _private_helper(x: int) -> int:
    return x * 2
