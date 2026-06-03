package main

import (
	"fmt"
	"myapp/pkg/auth"
)

func main() {
	user := auth.NewUser("alice", "secret")
	fmt.Println(auth.Greet(user))
}

func Helper(x int) int {
	return x + 1
}
