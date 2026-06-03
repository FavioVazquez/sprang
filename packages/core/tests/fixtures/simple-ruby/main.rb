require_relative 'lib/user'
require_relative 'lib/auth'

def main
  user = User.new('alice', 'secret')
  auth = Auth.new
  if auth.authenticate(user)
    puts greet(user.name)
  end
end

def greet(name)
  "Hello, #{name}!"
end

main
