const display = document.getElementById("display");
const buttons = document.querySelectorAll("button");

let currentInput = "0";
let firstNumber = null;
let operator = null;
let waitingForSecondNumber = false;


// Update calculator display
function updateDisplay() {
    display.textContent = currentInput;
}


// Handle number input
function inputNumber(number) {

    if (waitingForSecondNumber) {
        currentInput = number;
        waitingForSecondNumber = false;
    } else {
        currentInput =
            currentInput === "0"
                ? number
                : currentInput + number;
    }

    updateDisplay();
}


// Handle operators
function chooseOperator(nextOperator) {

    const inputValue = parseFloat(currentInput);

    if (operator && waitingForSecondNumber) {
        operator = nextOperator;
        return;
    }

    if (firstNumber === null) {
        firstNumber = inputValue;
    } else if (operator) {
        const result = calculate(firstNumber, inputValue, operator);

        currentInput = String(result);
        firstNumber = result;
        updateDisplay();
    }

    operator = nextOperator;
    waitingForSecondNumber = true;
}


// Perform calculation
function calculate(first, second, operation) {

    switch (operation) {

        case "+":
            return first + second;

        case "-":
            return first - second;

        case "*":
            return first * second;

        case "/":
            if (second === 0) {
                return "Error";
            }
            return first / second;

        default:
            return second;
    }
}


// Calculate final result
function calculateResult() {

    if (operator === null || firstNumber === null) {
        return;
    }

    const secondNumber = parseFloat(currentInput);

    if (isNaN(secondNumber)) {
        return;
    }

    const result = calculate(
        firstNumber,
        secondNumber,
        operator
    );

    currentInput = String(result);

    firstNumber = null;
    operator = null;
    waitingForSecondNumber = false;

    updateDisplay();
}


// Clear calculator
function clearCalculator() {

    currentInput = "0";
    firstNumber = null;
    operator = null;
    waitingForSecondNumber = false;

    updateDisplay();
}


// Handle button clicks
buttons.forEach(button => {

    button.addEventListener("click", () => {

        const value = button.textContent;

        // Number
        if (!isNaN(value)) {
            inputNumber(value);
        }

        // Clear
        else if (value === "C") {
            clearCalculator();
        }

        // Operators
        else if (
            value === "+" ||
            value === "-" ||
            value === "*" ||
            value === "/"
        ) {
            chooseOperator(value);
        }

        // Equal
        else if (value === "=") {
            calculateResult();
        }
    });

});


// Keyboard support
document.addEventListener("keydown", (event) => {

    const key = event.key;

    // Numbers 0-9
    if (key >= "0" && key <= "9") {
        inputNumber(key);
    }

    // Operators
    else if (
        key === "+" ||
        key === "-" ||
        key === "*" ||
        key === "/"
    ) {
        chooseOperator(key);
    }

    // Enter or =
    else if (key === "Enter" || key === "=") {
        event.preventDefault();
        calculateResult();
    }

    // Escape or C
    else if (key === "Escape" || key.toLowerCase() === "c") {
        clearCalculator();
    }

});