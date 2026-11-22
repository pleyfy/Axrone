#pragma once

#include <stddef.h>

extern "C" {
void* memset(void* dest, int value, size_t count);
void* memcpy(void* dest, const void* source, size_t count);
void* memmove(void* dest, const void* source, size_t count);
int memcmp(const void* left, const void* right, size_t count);
}
