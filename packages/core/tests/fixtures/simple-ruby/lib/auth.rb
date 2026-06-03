require_relative 'user'

class Auth
  def authenticate(user)
    !user.name.nil? && !user.name.empty?
  end

  def generate_token(user)
    "token-#{user.name}"
  end
end
