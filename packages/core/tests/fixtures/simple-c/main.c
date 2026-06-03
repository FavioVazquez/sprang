#include "utils.h"
#include <stdio.h>

int main(void) {
    char* msg = greet("Alice");
    printf("%s\n", msg);
    return 0;
}

int add(int a, int b) {
    return a + b;
}
