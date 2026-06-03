class User
  attr_reader :name, :email

  def initialize(name, email)
    @name = name
    @email = email
  end

  def display
    "#{@name} <#{@email}>"
  end
end
