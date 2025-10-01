"""DB-API 2.0 Exception Classes"""

class Error(Exception):
    """Base class for all database exceptions"""
    pass

class Warning(Exception):
    """Exception raised for important warnings"""
    pass

class InterfaceError(Error):
    """Exception raised for errors related to the database interface"""
    pass

class DatabaseError(Error):
    """Exception raised for errors related to the database"""
    pass

class DataError(DatabaseError):
    """Exception raised for errors due to problems with the processed data"""
    pass

class OperationalError(DatabaseError):
    """Exception raised for errors related to the database's operation"""
    pass

class IntegrityError(DatabaseError):
    """Exception raised when the relational integrity of the database is affected"""
    pass

class InternalError(DatabaseError):
    """Exception raised when the database encounters an internal error"""
    pass

class ProgrammingError(DatabaseError):
    """Exception raised for programming errors"""
    pass

class NotSupportedError(DatabaseError):
    """Exception raised when a method or database API is not supported"""
    pass
