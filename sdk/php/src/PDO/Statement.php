<?php

namespace WorkerSQL\PDO;

use WorkerSQL\Client;

/**
 * PDO-compatible statement for WorkerSQL
 */
class Statement implements \IteratorAggregate
{
    private Client $client;
    private string $queryString;
    private array $boundParams = [];
    private ?array $result = null;
    private int $rowCount = 0;
    private int $fetchMode = \PDO::FETCH_BOTH;

    public function __construct(Client $client, string $queryString)
    {
        $this->client = $client;
        $this->queryString = $queryString;
    }

    public function execute(?array $params = null): bool
    {
        $executeParams = $params ?? $this->boundParams;
        
        try {
            $result = $this->client->query($this->queryString, array_values($executeParams));
            
            if (isset($result['data']['rows'])) {
                $this->result = $result['data']['rows'];
            }
            
            $this->rowCount = $result['data']['rowsAffected'] ?? count($this->result ?? []);
            
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    public function bindParam($param, &$variable, int $type = \PDO::PARAM_STR, ?int $length = null): bool
    {
        // For named parameters
        if (is_string($param)) {
            $param = ltrim($param, ':');
        }
        
        $this->boundParams[$param] = &$variable;
        return true;
    }

    public function bindValue($param, $value, int $type = \PDO::PARAM_STR): bool
    {
        if (is_string($param)) {
            $param = ltrim($param, ':');
        }
        
        $this->boundParams[$param] = $value;
        return true;
    }

    public function fetch(int $mode = null, int $cursorOrientation = \PDO::FETCH_ORI_NEXT, int $cursorOffset = 0)
    {
        if ($this->result === null || count($this->result) === 0) {
            return false;
        }

        $row = array_shift($this->result);
        $mode = $mode ?? $this->fetchMode;

        return $this->formatRow($row, $mode);
    }

    public function fetchAll(int $mode = null): array
    {
        if ($this->result === null) {
            return [];
        }

        $mode = $mode ?? $this->fetchMode;
        $rows = [];

        foreach ($this->result as $row) {
            $rows[] = $this->formatRow($row, $mode);
        }

        $this->result = []; // Clear result set

        return $rows;
    }

    public function fetchColumn(int $column = 0)
    {
        $row = $this->fetch(\PDO::FETCH_NUM);
        
        if ($row === false) {
            return false;
        }

        return $row[$column] ?? null;
    }

    public function fetchObject(?string $className = "stdClass", ?array $constructorArgs = null)
    {
        $row = $this->fetch(\PDO::FETCH_ASSOC);
        
        if ($row === false) {
            return false;
        }

        if ($className === "stdClass") {
            return (object)$row;
        }

        $object = new $className(...($constructorArgs ?? []));
        foreach ($row as $key => $value) {
            $object->$key = $value;
        }

        return $object;
    }

    public function rowCount(): int
    {
        return $this->rowCount;
    }

    public function columnCount(): int
    {
        if ($this->result === null || count($this->result) === 0) {
            return 0;
        }

        return count($this->result[0]);
    }

    public function setFetchMode(int $mode): bool
    {
        $this->fetchMode = $mode;
        return true;
    }

    public function closeCursor(): bool
    {
        $this->result = null;
        return true;
    }

    private function formatRow(array $row, int $mode)
    {
        switch ($mode) {
            case \PDO::FETCH_ASSOC:
                return $row;
            
            case \PDO::FETCH_NUM:
                return array_values($row);
            
            case \PDO::FETCH_BOTH:
                $numericKeys = array_values($row);
                return array_merge($row, $numericKeys);
            
            case \PDO::FETCH_OBJ:
                return (object)$row;
            
            default:
                return $row;
        }
    }

    public function getIterator(): \ArrayIterator
    {
        return new \ArrayIterator($this->result ?? []);
    }
}
