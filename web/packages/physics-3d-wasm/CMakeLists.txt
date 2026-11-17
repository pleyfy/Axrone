cmake_minimum_required(VERSION 3.28)

project(axrone_physics_wasm LANGUAGES CXX)

option(PHYSICS_BUILD_TESTS "Build native tests" ON)
option(PHYSICS_BUILD_WASM "Build the WASM module" ON)
option(PHYSICS_SIMD "Enable wasm SIMD" OFF)
option(PHYSICS_FAST_MATH "Enable fast-math" OFF)
option(PHYSICS_PHASE_TIMERS "Instrument step phase timers" OFF)
option(PHYSICS_WASM_OPTIMIZE "Run wasm-opt after linking" ON)
set(PHYSICS_WASM_OPT_LEVEL "-O4" CACHE STRING "wasm-opt optimization level")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(PHYSICS_CORE_SOURCES
    src/core/world.cpp
    src/core/broadphase.cpp
    src/core/bulk.cpp
    src/core/constraints.cpp
    src/core/narrowphase.cpp
    src/core/polytope.cpp
    src/core/solver.cpp
    src/core/query.cpp
    src/core/events.cpp
    src/runtime/arena.cpp
)

add_library(axrone_physics_core STATIC ${PHYSICS_CORE_SOURCES})
target_include_directories(axrone_physics_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
target_compile_options(axrone_physics_core PRIVATE
    -Wall
    -Wextra
    -Werror
    -Wshadow
    -Wundef
    -ffp-contract=off
    -fvisibility=hidden
    -ffunction-sections
    -fdata-sections
)

if(PHYSICS_FAST_MATH)
    target_compile_options(axrone_physics_core PRIVATE -ffast-math -ffp-contract=fast)
endif()

if(PHYSICS_PHASE_TIMERS)
    target_compile_definitions(axrone_physics_core PUBLIC AXRONE_PHYSICS_PHASE_TIMERS=1)
endif()

if(PHYSICS_SIMD)
    target_compile_options(axrone_physics_core PRIVATE -msimd128)
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "wasm32")
    target_compile_options(axrone_physics_core PRIVATE
        -nostdlib
        -ffreestanding
        -fno-exceptions
        -fno-rtti
        -flto
    )
    target_link_options(axrone_physics_core PRIVATE -nostdlib -flto)
endif()

if(PHYSICS_BUILD_WASM AND CMAKE_SYSTEM_PROCESSOR MATCHES "wasm32")
    add_executable(axrone_physics_wasm
        src/abi/exports.cpp
        src/runtime/memory.cpp
    )
    target_link_libraries(axrone_physics_wasm PRIVATE axrone_physics_core)
    target_compile_options(axrone_physics_wasm PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
        -fvisibility=hidden
        -ffunction-sections
        -fdata-sections
        -nostdlib
        -ffreestanding
        -fno-exceptions
        -fno-rtti
        -flto
    )
    if(PHYSICS_FAST_MATH)
        target_compile_options(axrone_physics_wasm PRIVATE -ffast-math -ffp-contract=fast)
    endif()
    if(PHYSICS_SIMD)
        target_compile_options(axrone_physics_wasm PRIVATE -msimd128)
    endif()

    set_source_files_properties(src/runtime/memory.cpp PROPERTIES COMPILE_OPTIONS "-fno-builtin")

    target_link_options(axrone_physics_wasm PRIVATE
        -nostdlib
        -flto
        -Wl,--no-entry
        -Wl,--gc-sections
        -Wl,--export-memory
        -Wl,--stack-first
        -Wl,-z,stack-size=262144
    )

    set_target_properties(axrone_physics_wasm PROPERTIES
        PREFIX ""
        SUFFIX ".wasm"
        OUTPUT_NAME "physics"
    )

    if(PHYSICS_WASM_OPTIMIZE)
        find_program(PHYSICS_WASM_OPT_EXECUTABLE
            NAMES wasm-opt
            HINTS
                ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin
                ${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/.bin
        )
        if(PHYSICS_WASM_OPT_EXECUTABLE)
            set(PHYSICS_WASM_FEATURES
                --enable-bulk-memory
                --enable-mutable-globals
                --enable-sign-ext
                --enable-nontrapping-float-to-int
                --enable-multivalue
            )
            if(PHYSICS_SIMD)
                list(APPEND PHYSICS_WASM_FEATURES --enable-simd)
            endif()
            add_custom_command(TARGET axrone_physics_wasm POST_BUILD
                COMMAND ${PHYSICS_WASM_OPT_EXECUTABLE}
                    ${PHYSICS_WASM_OPT_LEVEL}
                    ${PHYSICS_WASM_FEATURES}
                    --strip-dwarf
                    --strip-producers
                    $<TARGET_FILE:axrone_physics_wasm>
                    -o $<TARGET_FILE_DIR:axrone_physics_wasm>/physics.opt.wasm
                VERBATIM
            )
        endif()
    endif()
endif()

if(PHYSICS_BUILD_TESTS AND NOT CMAKE_SYSTEM_PROCESSOR MATCHES "wasm32")
    enable_testing()
    add_executable(axrone_physics_tests
        tests/test_main.cpp
    )
    target_link_libraries(axrone_physics_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_tests COMMAND axrone_physics_tests)

    add_executable(axrone_physics_query_tests
        tests/query_test.cpp
    )
    target_link_libraries(axrone_physics_query_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_query_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_query_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_query_tests COMMAND axrone_physics_query_tests)

    add_executable(axrone_physics_contacts_tests
        tests/contacts_test.cpp
    )
    target_link_libraries(axrone_physics_contacts_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_contacts_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_contacts_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_contacts_tests COMMAND axrone_physics_contacts_tests)

    add_executable(axrone_physics_warmstart_tests
        tests/warmstart_test.cpp
    )
    target_link_libraries(axrone_physics_warmstart_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_warmstart_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_warmstart_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_warmstart_tests COMMAND axrone_physics_warmstart_tests)

    add_executable(axrone_physics_counters_tests
        tests/counters_test.cpp
    )
    target_link_libraries(axrone_physics_counters_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_counters_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_counters_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_counters_tests COMMAND axrone_physics_counters_tests)

    add_executable(axrone_physics_rotation_funnel_tests
        tests/rotation_funnel_test.cpp
    )
    target_link_libraries(axrone_physics_rotation_funnel_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_rotation_funnel_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_rotation_funnel_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_rotation_funnel_tests COMMAND axrone_physics_rotation_funnel_tests)

    add_executable(axrone_physics_solver_pair_state_tests
        tests/solver_pair_state_test.cpp
    )
    target_link_libraries(axrone_physics_solver_pair_state_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_solver_pair_state_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_solver_pair_state_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_solver_pair_state_tests COMMAND axrone_physics_solver_pair_state_tests)

    add_executable(axrone_physics_contact_layout_tests
        tests/contact_layout_test.cpp
    )
    target_link_libraries(axrone_physics_contact_layout_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_contact_layout_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_contact_layout_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_contact_layout_tests COMMAND axrone_physics_contact_layout_tests)

    add_executable(axrone_physics_jointmask_tests
        tests/jointmask_test.cpp
    )
    target_link_libraries(axrone_physics_jointmask_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_jointmask_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_jointmask_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_jointmask_tests COMMAND axrone_physics_jointmask_tests)

    add_executable(axrone_physics_events_tests
        tests/events_test.cpp
    )
    target_link_libraries(axrone_physics_events_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_events_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_events_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_events_tests COMMAND axrone_physics_events_tests)

    add_executable(axrone_physics_bulk_tests
        tests/bulk_test.cpp
    )
    target_link_libraries(axrone_physics_bulk_tests PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_bulk_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_bulk_tests PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
    add_test(NAME axrone_physics_bulk_tests COMMAND axrone_physics_bulk_tests)

    add_executable(axrone_physics_fingerprint
        tests/fingerprint_main.cpp
    )
    target_link_libraries(axrone_physics_fingerprint PRIVATE axrone_physics_core)
    target_include_directories(axrone_physics_fingerprint PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_compile_options(axrone_physics_fingerprint PRIVATE
        -Wall
        -Wextra
        -Werror
        -Wshadow
        -Wundef
        -ffp-contract=off
    )
endif()
