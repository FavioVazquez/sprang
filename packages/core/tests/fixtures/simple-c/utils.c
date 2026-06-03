#include "utils.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

char* greet(const char* name) {
    char* buf = malloc(64);
    snprintf(buf, 64, "Hello, %s!", name);
    return buf;
}

int multiply(int a, int b) {
    return a * b;
}
