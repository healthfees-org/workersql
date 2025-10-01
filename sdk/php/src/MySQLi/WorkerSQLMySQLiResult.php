<?php

declare(strict_types=1);

namespace WorkerSQL\MySQLi;

use mysqli_result;

/**
 * MySQLi Result Set
 */
class WorkerSQLMySQLiResult extends mysqli_result
{
    private array $data;
    private int $position = 0;

    public function __construct(array $data)
    {
        $this->data = $data;
    }

    /**
     * Fetch a result row as an associative array
     *
     * @return array|null
     */
    public function fetch_assoc(): ?array
    {
        if (!isset($this->data[$this->position])) {
            return null;
        }
        return $this->data[$this->position++];
    }

    /**
     * Fetch a result row as a numeric array
     *
     * @return array|null
     */
    public function fetch_array(): ?array
    {
        if (!isset($this->data[$this->position])) {
            return null;
        }
        $row = $this->data[$this->position++];
        return array_merge($row, array_values($row));
    }

    /**
     * Fetch a result row as an object
     *
     * @param string $class Class name
     * @param array $constructor_args Constructor arguments
     * @return object|null
     */
    public function fetch_object(string $class = "stdClass", array $constructor_args = []): ?object
    {
        if (!isset($this->data[$this->position])) {
            return null;
        }
        $row = $this->data[$this->position++];

        if ($class === "stdClass") {
            return (object)$row;
        }

        $object = new $class(...$constructor_args);
        foreach ($row as $key => $value) {
            $object->$key = $value;
        }
        return $object;
    }

    /**
     * Fetch all rows
     *
     * @return array
     */
    public function fetch_all(int $mode = MYSQLI_ASSOC): array
    {
        $results = [];
        foreach ($this->data as $row) {
            $results[] = match ($mode) {
                MYSQLI_NUM => array_values($row),
                MYSQLI_BOTH => array_merge($row, array_values($row)),
                default => $row,
            };
        }
        return $results;
    }

    /**
     * Get the number of rows
     *
     * @return int
     */
    public function num_rows(): int
    {
        return count($this->data);
    }

    /**
     * Free the result memory
     */
    public function free(): void
    {
        $this->data = [];
        $this->position = 0;
    }

    /**
     * Magic property getter
     *
     * @param string $name Property name
     * @return mixed
     */
    public function __get(string $name): mixed
    {
        return match ($name) {
            'num_rows' => count($this->data),
            default => null,
        };
    }
}
