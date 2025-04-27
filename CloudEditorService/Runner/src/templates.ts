import { languageEnvironments, saveToS3 } from "./AWS";
import fs from "fs";
import path from "path";

// Node.js template files
const nodejsFiles = {
    "index.js": `// Welcome to Cloud Code Editor
console.log("Hello, world!");

function greet(name) {
    return \`Hello, \${name}!\`;
}

console.log(greet("User"));
`,
    "package.json": JSON.stringify({
        "name": "nodejs-project",
        "version": "1.0.0",
        "description": "Node.js project created with Cloud Code Editor",
        "main": "index.js",
        "scripts": {
            "start": "node index.js",
            "test": "echo \"Error: no test specified\" && exit 1"
        },
        "dependencies": {},
        "keywords": [],
        "author": "",
        "license": "ISC"
    }, null, 2)
};

// Python template files
const pythonFiles = {
    "main.py": `# Welcome to Cloud Code Editor
print("Hello, world!")

def greet(name):
    return f"Hello, {name}!"

print(greet("User"))
`,
    "requirements.txt": `# Python dependencies
# Uncomment lines to install packages
# flask==2.0.1
# requests==2.26.0
`
};

// Java template files
const javaFiles = {
    "Main.java": `// Welcome to Cloud Code Editor
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
        System.out.println(greet("User"));
    }
    
    public static String greet(String name) {
        return "Hello, " + name + "!";
    }
}
`
};

// C++ template files
const cppFiles = {
    "main.cpp": `// Welcome to Cloud Code Editor
#include <iostream>
#include <string>

std::string greet(const std::string& name) {
    return "Hello, " + name + "!";
}

int main() {
    std::cout << "Hello, world!" << std::endl;
    std::cout << greet("User") << std::endl;
    return 0;
}
`,
    "CMakeLists.txt": `cmake_minimum_required(VERSION 3.10)
project(CppProject)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(main main.cpp)
`
};

// Go template files
const goFiles = {
    "main.go": `// Welcome to Cloud Code Editor
package main

import "fmt"

func greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}

func main() {
    fmt.Println("Hello, world!")
    fmt.Println(greet("User"))
}
`,
    "go.mod": `module cloudeditor

go 1.20
`
};

// Map languages to template files
const templateFiles = {
    nodejs: nodejsFiles,
    python: pythonFiles,
    java: javaFiles,
    cpp: cppFiles,
    go: goFiles
};

async function createTemplates() {
    try {
        for (const [language, files] of Object.entries(templateFiles)) {
            console.log(`Creating templates for ${language}...`);
            
            for (const [filename, content] of Object.entries(files)) {
                const templateFolder = languageEnvironments[language].templateFolder;
                console.log(`Uploading ${filename} to ${templateFolder}`);
                await saveToS3(templateFolder, `/${filename}`, content);
            }
        }
        
        console.log("All templates created successfully");
    } catch (error) {
        console.error("Failed to create templates:", error);
    }
}

createTemplates();