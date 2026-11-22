#pragma once

#include <stddef.h>
#include <stdint.h>

namespace axrone::physics {

class Arena {
public:
    void init(unsigned char* base, size_t capacity);
    void reset();
    void* alloc(size_t size, size_t alignment);

    unsigned char* base() const;
    size_t used() const;
    size_t capacity() const;
    void shrinkTo(size_t offset);

private:
    bool growTo(size_t requiredBytes);

    unsigned char* base_;
    size_t capacity_;
    size_t offset_;
};

}
