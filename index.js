#!/usr/bin/env node

const ELK = require('elkjs');
const _ = require('lodash');
const assert = require('assert');

function isEdge(nodeJson) {  // TODO: this may need to change
    const pointers = nodeJson.pointers || {};
    return pointers.src && pointers.dst;
}

let idSuffix = Date.now();
function newID() {
    return `@id:nodeID_${idSuffix++}`;
}

async function layout(nodeJson) {
    const elk = new ELK();

    const children = nodeJson.children || [];
    await children.reduce(async (promise, node) => {
        await promise;
        await layout(node);
    }, Promise.resolve());

    const graph = await elk.layout(getElkJson(nodeJson, true));
    applyLayout(nodeJson, graph);
    return nodeJson;
}

function applyLayout(nodeJson, layout) {
    const childNodes = (nodeJson.children || [])
        .filter(node => !isEdge(node));

    childNodes.forEach(child => {
        const childLayout = layout.children.find(cl => cl.id === child.id);
        assert(
            childLayout,
            `Could not find ${child.id} in ${JSON.stringify(layout.children.map(c => c.id), null, 2)}`
        );
        const {x, y} = childLayout;
        child.registry = child.registry || {};
        child.registry.position = {x, y};
    });
}

function addMissingNodeIDs(nodeJson) {
    nodeJson.id = nodeJson.id || newID();
    const children = nodeJson.children || [];
    children.forEach(addMissingNodeIDs);
}

function getNodeID(nodeJson) {
    if (!nodeJson.id) {
        throw new Error(`Missing node ID: ${JSON.stringify(nodeJson, null, 2)}`);
    }
    return nodeJson.id;
}

function getElkJson(nodeJson, shallow=false) {
    const [edges, children] = _.partition(nodeJson.children || [], isEdge);
    const elkJson = getElkNodeJson(nodeJson, {}, children);
    const portSideDict = Object.fromEntries(
        edges.flatMap(edge => [
            [edge.pointers.src, 'SOUTH'],
            [edge.pointers.dst, 'NORTH'],
        ])
    );
    const portDict = Object.fromEntries(
        children.flatMap(node => (node.children || []).map(child => [getNodeID(child), getNodeID(node)]))
    );
    elkJson.edges = edges.map(edge => getEdgeJson(edge, portDict));
    elkJson.layoutOptions = {
        'elk.algorithm': 'layered',
        'org.eclipse.elk.direction': 'DOWN',
        'org.eclipse.elk.spacing.nodeNode': 40,
        'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': 40
    };
    elkJson.children = children.map(child => shallow ? getElkNodeJson(child, portSideDict) : getElkJson(child));

    return elkJson;
}

function getElkNodeJson(nodeJson, portSideDict={}, children) {
    if (!children) {
        children = (nodeJson.children || []).filter(node => !isEdge(node));
    }
    const portDict = Object.fromEntries(
        children.flatMap(node => (node.children || []).map(child => [getNodeID(child), getNodeID(node)]))
    );
    const ports = children
        .filter(child => portSideDict[getNodeID(child)])
        .map(child => ({
            id: getNodeID(child),
            width: 1,
            height: 1,
            properties: {
                'org.eclipse.elk.port.side': portSideDict[child.id]
            },
        }));

    return {
        id: getNodeID(nodeJson),
        height: 100,
        width: 150,
        ports: ports,
    };
}

function getEdgeJson(edge, portToParentDict) {
    return {
        id: getNodeID(edge),
        source: portToParentDict[edge.pointers.src],
        target: portToParentDict[edge.pointers.dst],
        sourcePort: edge.pointers.src,
        targetPort: edge.pointers.dst,
    };
}

const path = require('path');

if (process.argv.length < 3) {
    let jsonData = '';
    process.stdin.on('readable', function() {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
            jsonData += chunk;
        }

    });
    process.stdin.on('end', () => {
        if (jsonData.length) {
            handleInput(JSON.parse(jsonData));
        } else {
            console.error(`usage: ${process.argv[1]} <path-to-file.json>`);
            process.exit(1);
        }
    });
} else {
    const json = require(path.resolve(process.argv[2]));
    handleInput(json)
}

async function handleInput(json) {
    addMissingNodeIDs(json);
    console.log(JSON.stringify(await layout(json), null, 2));
}
