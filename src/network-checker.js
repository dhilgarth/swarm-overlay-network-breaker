#!/usr/bin/env node

const fs = require('fs');
const {execSync} = require('child_process');
const path = require('path');

// ==================== Configuration ====================

// Directory and file configurations
const CHECKER_DIR = 'checker';
const SCRIPT_FILE = path.join(CHECKER_DIR, 'checker.sh');
const DOCKERFILE = path.join(CHECKER_DIR, 'Dockerfile');
const DOCKER_USER = executeCommand("docker info").split("\n").map(x => x.trim()).filter(x => x.startsWith('Username:')).map(x => x.replace('Username: ', ''))[0]
if (!DOCKER_USER?.length) {
    console.error('No docker user found. Are you logged in?')
    process.exit(1)
}
const IMAGE_NAME = `${DOCKER_USER}/network-checker:latest`;

// ANSI color codes for colored output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const WHITE = '\x1b[37m';
const UNDERLINE = '\x1b[4m';
const RESET = '\x1b[0m';

// Networks to monitor
const NETWORKS = ['web', 'internal'];

// Sleep duration between monitoring cycles (in milliseconds)
const SLEEP_DURATION = 13;

// =========================================================

// Function to execute shell commands synchronously
function executeCommand(command) {
    try {
        return execSync(command, {stdio: 'pipe'}).toString().trim();
    } catch (error) {
        console.error(`${RED}Error executing command: ${command}${RESET}`);
        console.error(error.stderr.toString());
        process.exit(1);
    }
}

// Function to create directories
function createDirectory(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }
}

// Function to write content to a file
function writeFile(filePath, content) {
    fs.writeFileSync(filePath, content, {encoding: 'utf8'});
}

// Function to make a file executable
function makeExecutable(filePath) {
    fs.chmodSync(filePath, 0o755);
}

// Function to build and push Docker image
function buildAndPushDockerImage() {
    console.log(`Building Docker image: ${IMAGE_NAME}`);
    executeCommand(`docker build -t ${IMAGE_NAME} ${CHECKER_DIR}`);
    console.log(`Pushing Docker image: ${IMAGE_NAME}`);
    executeCommand(`docker push ${IMAGE_NAME}`);
}

// Function to check if all tasks of a service have completed
function checkServiceCompletion(serviceName) {
    // Get total number of nodes
    const totalNodes = parseInt(executeCommand('docker node ls -q | wc -l'), 10);

    // Get number of tasks in terminal state
    const completedTasks = parseInt(
        executeCommand(`docker service ps ${serviceName} --format "{{.CurrentState}}" | grep -E "Complete|Shutdown|Failed" | wc -l`),
        10
    );

    console.log(`${serviceName}: ${completedTasks} of ${totalNodes} tasks completed.`);
    return completedTasks >= totalNodes;
}

// Function to sleep for a specified duration
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shortenNodeName(input) {
    const parts = input.split('-');
    const index = parseInt(parts[parts.length - 1]);
    return `${parts[parts.length - 2][0]}-${index < 10 ? `0${index}` : index}`;
}

function shortenServiceName(input) {
    const parts = input.split('-');
    return `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
}

function tableCell(input) {
    input = input.substring(0, 15);
    return `${input}${Array.from({length: 15 - input.length}).map(_ => ' ').join('')}`;
}

function printTable(allServices, groupedResults) {
    for (const network in groupedResults) {
        console.log(`Network: ${network}${RESET}`);
        console.log('');

        console.log(`      ${[...allServices].map(x => tableCell(shortenServiceName(x))).join('  ')}`);
        for (const node of Object.keys(groupedResults[network]).sort()) {
            const services = groupedResults[network][node].sort((x, y) => x.service.localeCompare(y.service));
            console.log(`${WHITE}${shortenNodeName(node)}${RESET}  ${
                services.map(x => `${x.success ? GREEN : RED}${tableCell(x.result)}${RESET}`).join('  ')}${RESET}`);
        }
        console.log('');
    }
}

// Function to display DNS and GET results in a grouped and compact format
function displayResults(dnsResults, getResults) {
    const dnsGrouped = {};
    const allServicesDns = new Set();
    for (const {network, node, ...rest} of dnsResults) {
        if (!dnsGrouped[network]) {
            dnsGrouped[network] = [];
        }
        if (!dnsGrouped[network][node]) {
            dnsGrouped[network][node] = [];
        }
        dnsGrouped[network][node].push(rest);
        allServicesDns.add(rest.service);
    }

    const getGrouped = {};
    const allServicesGet = new Set();
    for (const {network, node, ...rest} of getResults) {
        if (!getGrouped[network]) {
            getGrouped[network] = [];
        }
        if (!getGrouped[network][node]) {
            getGrouped[network][node] = [];
        }
        getGrouped[network][node].push(rest);
        allServicesGet.add(rest.service);
    }

    console.log('');
    console.log(`${WHITE}${UNDERLINE}DNS Lookup Results:${RESET}`);
    printTable(allServicesDns, dnsGrouped);

    console.log('');
    console.log(`${WHITE}${UNDERLINE}GET Request Results to Global Services:${RESET}`);
    printTable(allServicesGet, getGrouped);
}

// Main monitoring function
async function monitorNetworks() {
    while (true) {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        console.log(`\n==========================================`);
        console.log(`Report Time: ${timestamp}`);
        console.log(`==========================================`);

        const services = NETWORKS.map(x => ({network: x, serviceName: `network-checker-${x}`}));
        services.forEach(({network, serviceName}) => executeCommand(
            `docker service create --detach --name ${serviceName} --network ${network} --mode global --env NODE_NAME="{{.Node.Hostname}}" --restart-condition none ${IMAGE_NAME}`
        ));

        // Wait until all tasks have completed
        while (!services.reduce((acc, curr) => acc & checkServiceCompletion(curr.serviceName), true)) {
            await sleep(2000); // Sleep for 2 seconds
        }

        const dnsResults = [];
        const getResults = [];

        for (const {serviceName, network} of services) {

            // Collect logs from all tasks
            const tasks = executeCommand(`docker service ps ${serviceName} --format "{{.ID}}"`).split('\n').filter(id => id);
            let result = '';

            for (const taskId of tasks) {
                const taskLog = executeCommand(`docker service logs --raw ${taskId}`);
                result += `${taskLog}\n`;
            }

            // Remove the service
            executeCommand(`docker service rm ${serviceName}`);

            const lines = result.split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                const parts = line.split(':');
                const [node, type, service, info1, info2] = parts;

                switch (type) {
                case 'DNS_SUCCESS':
                    dnsResults.push({network, service, node, result: info1, success: true});
                    break;
                case 'DNS_NO_IPS':
                    dnsResults.push({network, service, node, result: 'no IP', success: false});
                    break;
                case 'DNS_FAIL':
                    dnsResults.push({network, service, node, result: info1, success: false});
                    break;
                case 'GET_SUCCESS':
                    getResults.push({
                        network,
                        service,
                        node,
                        result: `${info1},${info2}s`,
                        success: true
                    });
                    break;
                case 'GET_HTTP_FAIL':
                    getResults.push({
                        network,
                        service,
                        node,
                        result: `${info1},${info2}s`,
                        success: false
                    });
                    break;
                case 'GET_FAIL':
                    getResults.push({network, service, node, result: info1, success: false});
                    break;
                default:
                    // Handle unexpected types if necessary
                    break;
                }
            }
        }

        displayResults(dnsResults, getResults);

        console.log(`Done, sleeping ${SLEEP_DURATION} seconds...`);
        await sleep(SLEEP_DURATION * 1000); // Sleep for 53 seconds
    }
}

// Entry point of the script
function main() {
    // Step 1: Create the checker directory
    createDirectory(CHECKER_DIR);

    // Step 2: Write checker.sh
    const checkerScriptContent = `#!/bin/sh

# Define services
SERVICES_GLOBAL="network-breaker-global-1 network-breaker-global-2 network-breaker-global-3 network-breaker-global-4 network-breaker-global-5 network-breaker-global-6 network-breaker-global-7"
SERVICES_REPLICATED="network-breaker-replicated-1 network-breaker-replicated-2 network-breaker-replicated-3 network-breaker-replicated-4 network-breaker-replicated-5 network-breaker-replicated-6 network-breaker-replicated-7"

# DNS Results
for SERVICE in $SERVICES_GLOBAL $SERVICES_REPLICATED; do
  HOST_OUTPUT=$(host "$SERVICE")
  if [ $? -eq 0 ]; then
    if echo "$HOST_OUTPUT" | grep -q "has address"; then
      IP=$(echo "$HOST_OUTPUT" | grep "has address" | awk '{print $4}')
      echo "$NODE_NAME:DNS_SUCCESS:$SERVICE:$IP"
    else
      echo "$NODE_NAME:DNS_NO_IPS:$SERVICE"
    fi
  else
    echo "$NODE_NAME:DNS_FAIL:$SERVICE:$HOST_OUTPUT"
  fi
done

# GET Requests
for SERVICE in $SERVICES_GLOBAL; do
  CURL_OUTPUT=$(curl -s -o /dev/null -w "%{http_code}:%{time_total}" --connect-timeout 10 "http://$SERVICE" 2>&1)
  CURL_EXIT_CODE=$?
  if [ $CURL_EXIT_CODE -eq 0 ]; then
    HTTP_CODE=$(echo $CURL_OUTPUT | cut -d':' -f1)
    TIME_TOTAL=$(echo $CURL_OUTPUT | cut -d':' -f2)
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
      echo "$NODE_NAME:GET_SUCCESS:$SERVICE:$HTTP_CODE:$TIME_TOTAL"
    else
      echo "$NODE_NAME:GET_HTTP_FAIL:$SERVICE:$HTTP_CODE:$TIME_TOTAL"
    fi
  else
    case $CURL_EXIT_CODE in
      6)  ERROR_MSG="DNS_FAIL" ;;      # Could not resolve host
      7)  ERROR_MSG="CONN_FAIL" ;;     # Failed to connect to host
      28) ERROR_MSG="TIMEOUT" ;;       # Operation timeout
      35) ERROR_MSG="SSL_ERROR" ;;     # SSL connect error
      52) ERROR_MSG="EMPTY_RESP" ;;    # Empty reply from server
      *)  ERROR_MSG="ERR_$CURL_EXIT_CODE" ;; # Other errors
    esac
    echo "$NODE_NAME:GET_FAIL:$SERVICE:$ERROR_MSG"
  fi
done
`;
    writeFile(SCRIPT_FILE, checkerScriptContent);

    // Step 3: Write Dockerfile
    const dockerfileContent = `FROM alpine:latest

RUN apk add --no-cache bind-tools curl

COPY checker.sh /checker.sh
RUN chmod +x /checker.sh

ENTRYPOINT ["/checker.sh"]
`;
    writeFile(DOCKERFILE, dockerfileContent);

    // Step 4: Make checker.sh executable
    makeExecutable(SCRIPT_FILE);

    // Step 5: Build and push Docker image
    buildAndPushDockerImage();

    // Step 6: Start monitoring
    monitorNetworks();
}

// Run the main function
main();
