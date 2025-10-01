<?php

declare(strict_types=1);

namespace WorkerSQL;

/**
 * Validation exception with error codes
 */
class ValidationException extends \Exception
{
    private array $details;

    public function __construct(string $code, string $message, array $details = [])
    {
        parent::__construct($message, 0, null);
        $this->code = $code;
        $this->details = $details;
    }

    public function getDetails(): array
    {
        return $this->details;
    }
}
