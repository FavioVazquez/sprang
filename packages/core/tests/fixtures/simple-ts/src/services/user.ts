import { greet } from '../utils.js';
export class UserService {
  private users: Map<string, string> = new Map();
  addUser(id: string, name: string): void { this.users.set(id, name); }
  greetUser(id: string): string {
    const name = this.users.get(id);
    return name ? greet(name) : 'User not found';
  }
}
