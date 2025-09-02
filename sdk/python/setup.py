#!/usr/bin/env python3

from setuptools import setup, find_packages  # type: ignore[import]

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

with open("requirements.txt", "r", encoding="utf-8") as fh:
    requirements = [
        line.strip() for line in fh if line.strip() and not line.startswith("#")
    ]

setup(
    name="workersql-python-sdk",
    version="1.0.0",
    author="HealthFees Organization",
    author_email="developers@healthfees.org",
    description="Python SDK for WorkerSQL - MySQL at the edge on Cloudflare",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/healthfees-org/workersql",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Database",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
    python_requires=">=3.8",
    install_requires=requirements,
    extras_require={
        "dev": [
            "pytest>=7.4.0",
            "pytest-cov>=4.1.0",
            "black>=23.7.0",
            "isort>=5.12.0",
            "mypy>=1.5.0",
            "bandit>=1.7.5",
            "pre-commit>=3.3.0",
        ]
    },
    include_package_data=True,
    package_data={
        "": ["../schema/*.json"],
    },
)
