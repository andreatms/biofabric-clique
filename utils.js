const fs = require('fs');
const path = require('path');

function createCliqueModelFromGraph(graph, opt, prevSolution = null) {
  if (opt === "max") {
    return createCliqueModelFromGraphMAX(graph);
  } else if (opt === "min") {
    return createCliqueModelFromGraphMIN(graph);
  } else if (opt === "edge-max" && prevSolution !== null) {
    return createOrderingEdgeProblemMAX(graph, prevSolution);
  } else if (opt === "edge-min" && prevSolution !== null) {
    return createOrderingEdgeProblemMIN(graph, prevSolution);
  }
}

function createCliqueModelFromGraphMAX(graph) {
  let nodes = graph.nodes;
  let edges = graph.links || graph.edges;
  let cliques = graph.cliques || [];

  const m = nodes.length + 1;

  let model = {};

  model.objective_function = "Maximize \n";
  model.subjectTo = "Subject To \n";
  model.bounds = "\nBounds \n";

  let added_xvars = [];
  let added_zvars = [];

  // add definition of variables on y
  for (let i = 0; i < nodes.length - 1; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      let a = "n" + nodes[i].id;
      let b = "n" + nodes[j].id;
      let y_ab = "y_" + a + b;
      model.bounds += "binary " + y_ab + "\n";
      added_xvars.push(y_ab);
    }
  }

  // add transitivity constraints on y
  for (let i = 0; i < nodes.length - 2; i++) {
    for (let j = i + 1; j < nodes.length - 1; j++) {
      for (let k = j + 1; k < nodes.length; k++) {
        if (i == j || i == k || j == k) continue;

        let y_ab = "y_n" + nodes[i].id + "n" + nodes[j].id;
        let y_bc = "y_n" + nodes[j].id + "n" + nodes[k].id;
        let y_ac = "y_n" + nodes[i].id + "n" + nodes[k].id;

        // check that all these exist
        if (!added_xvars.includes(y_ab)) console.warn(y_ab + " not found");
        if (!added_xvars.includes(y_bc)) console.warn(y_bc + " not found");
        if (!added_xvars.includes(y_ac)) console.warn(y_ac + " not found");

        model.subjectTo += y_ab + " + " + y_bc + " - " + y_ac + " >= 0\n";
        model.subjectTo +=
          "- " + y_ab + " - " + y_bc + " + " + y_ac + " >= - 1\n";
      }
    }
  }

  // compute position of nodes
  for (let n1 of nodes) {
    let pos_n1 = "pos_n" + n1.id;
    let tmp_accumulator = nodes.length - 1;

    for (let n2 of nodes) {
      if (n1 == n2) continue;
      let y_n1n2 = "y_n" + n1.id + "n" + n2.id;

      if (!added_xvars.includes(y_n1n2)) {
        pos_n1 += " - " + "y_n" + n2.id + "n" + n1.id;
        tmp_accumulator -= 1;
      } else {
        pos_n1 += " + " + y_n1n2;
      }
    }
    model.subjectTo += pos_n1 + " = " + tmp_accumulator + "\n";
  }

  for (let i = 0; i < nodes.length; i++) {
    let adjacent_nodes = [];

    for (let j = 0; j < edges.length; j++) {
      if (
        edges[j].source == nodes[i].id &&
        !adjacent_nodes.includes(edges[j].target)
      ) {
        adjacent_nodes.push(nodes.find((n) => n.id == edges[j].target));
      } else if (
        edges[j].target == nodes[i].id &&
        !adjacent_nodes.includes(edges[j].source)
      ) {
        adjacent_nodes.push(nodes.find((n) => n.id == edges[j].source));
      }
    }

    for (let j = 0; j < adjacent_nodes.length; j++) {
      for (let k = j + 1; k < adjacent_nodes.length; k++) {
        if (j == k) continue;

        let node1 = adjacent_nodes[j];
        let node2 = adjacent_nodes[k];

        let sorted_node_ids = [node1.id, node2.id].sort((a, b) => a - b);

        let z1 = "z_n" + sorted_node_ids[0] + "n" + sorted_node_ids[1];
        added_zvars.push(z1);

        model.subjectTo +=
          "pos_n" +
          node2.id +
          " - pos_n" +
          node1.id +
          " + " +
          m +
          " " +
          z1 +
          " <= " +
          (1 + m + 0.01) +
          "\n";
        model.subjectTo +=
          "pos_n" +
          node2.id +
          " - pos_n" +
          node1.id +
          " - " +
          m +
          " " +
          z1 +
          " >= " +
          (-1 - m - 0.01) +
          "\n";

        model.bounds += "binary " + z1 + "\n";

        model.subjectTo += "pos_n" + node1.id + " <= " + nodes.length + "\n";
        model.subjectTo += "pos_n" + node2.id + " <= " + nodes.length + "\n";
      }
    }
  }

  let cliquesExtended = cliques;

  for (let clique of cliques) {
    if (clique.nodes.length > 3) {
      for (let node of clique.nodes) {
        let new_clique = {
          nodes: clique.nodes.filter((n) => n != node),
        };

        if (
          cliquesExtended.some(
            (c) =>
              c.nodes.length == new_clique.nodes.length &&
              c.nodes.every((n) => new_clique.nodes.includes(n)),
          )
        )
          continue;
        cliquesExtended.push(new_clique);
      }
    }
  }

  for (let clique of cliquesExtended) {
    let node_list = clique.nodes;
    let c = "c_";

    for (node of node_list) {
      c += "n" + node;
    }

    model.objective_function += c + " + ";

    let z_list = [];

    for (let i = 0; i < node_list.length - 1; i++) {
      for (let j = i + 1; j < node_list.length; j++) {
        let n1 = node_list[i];
        let n2 = node_list[j];

        let z_n1n2 = "z_n" + n1 + "n" + n2;
        let z_n2n1 = "z_n" + n2 + "n" + n1;

        if (added_zvars.includes(z_n1n2)) {
          z_list.push(z_n1n2);
        } else if (added_zvars.includes(z_n2n1)) {
          z_list.push(z_n2n1);
        } else {
          console.warn(
            "Variable for nodes " + n1 + " and " + n2 + " not found.",
          );
        }
      }
    }

    let z_constraint = c;

    for (let zvar of z_list) {
      z_constraint += " - " + zvar;
    }

    z_constraint += " = 1 \n";

    model.subjectTo += z_constraint;
  }

  model.objective_function =
    model.objective_function.substring(0, model.objective_function.length - 2) +
    "\n\n";

  // Build LP model as a string
  return model.objective_function + model.subjectTo + model.bounds + "\nEnd\n";
}

function createCliqueModelFromGraphMIN(graph) {
  let nodes = graph.nodes;
  let edges = graph.links || graph.edges;
  let cliques = graph.cliques || [];

  const m = nodes.length + 1;

  let model = {};

  model.objective_function = "Minimize \n";
  model.subjectTo = "Subject To \n";
  model.bounds = "\nBounds \n";

  let added_xvars = [];
  let added_zvars = [];

  // add definition of variables on y
  for (let i = 0; i < nodes.length - 1; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      let a = "n" + nodes[i].id;
      let b = "n" + nodes[j].id;
      let y_ab = "y_" + a + b;
      model.bounds += "binary " + y_ab + "\n";
      added_xvars.push(y_ab);
    }
  }

  // add transitivity constraints on y
  for (let i = 0; i < nodes.length - 2; i++) {
    for (let j = i + 1; j < nodes.length - 1; j++) {
      for (let k = j + 1; k < nodes.length; k++) {
        if (i == j || i == k || j == k) continue;

        let y_ab = "y_n" + nodes[i].id + "n" + nodes[j].id;
        let y_bc = "y_n" + nodes[j].id + "n" + nodes[k].id;
        let y_ac = "y_n" + nodes[i].id + "n" + nodes[k].id;

        // check that all these exist
        if (!added_xvars.includes(y_ab)) console.warn(y_ab + " not found");
        if (!added_xvars.includes(y_bc)) console.warn(y_bc + " not found");
        if (!added_xvars.includes(y_ac)) console.warn(y_ac + " not found");

        model.subjectTo += y_ab + " + " + y_bc + " - " + y_ac + " >= 0\n";
        model.subjectTo +=
          "- " + y_ab + " - " + y_bc + " + " + y_ac + " >= - 1\n";
      }
    }
  }

  // compute position of edges
  for (let n1 of nodes) {
    let pos_n1 = "pos_n" + n1.id;
    let tmp_accumulator = nodes.length - 1;

    for (let n2 of nodes) {
      if (n1 == n2) continue;
      let y_n1n2 = "y_n" + n1.id + "n" + n2.id;

      if (!added_xvars.includes(y_n1n2)) {
        pos_n1 += " - " + "y_n" + n2.id + "n" + n1.id;
        tmp_accumulator -= 1;
      } else {
        pos_n1 += " + " + y_n1n2;
      }
    }
    model.subjectTo += pos_n1 + " = " + tmp_accumulator + "\n";
  }

  for (let i = 0; i < nodes.length; i++) {

    let adjacent_nodes = [];

    for (let j = 0; j < edges.length; j++) {
      if (
        edges[j].source == nodes[i].id &&
        !adjacent_nodes.includes(edges[j].target)
      ) {
        adjacent_nodes.push(nodes.find((n) => n.id == edges[j].target));
      } else if (
        edges[j].target == nodes[i].id &&
        !adjacent_nodes.includes(edges[j].source)
      ) {
        adjacent_nodes.push(nodes.find((n) => n.id == edges[j].source));
      }
    }

    for (let j = 0; j < adjacent_nodes.length; j++) {
      for (let k = j + 1; k < adjacent_nodes.length; k++) {
        if (j == k) continue;

        let node1 = adjacent_nodes[j];
        let node2 = adjacent_nodes[k];

        let sorted_node_ids = [node1.id, node2.id].sort((a, b) => a - b);

        let z1 = "z_n" + sorted_node_ids[0] + "n" + sorted_node_ids[1];
        added_zvars.push(z1);

        model.subjectTo +=
          "pos_n" +
          node2.id +
          " - pos_n" +
          node1.id +
          " + " +
          m +
          " " +
          z1 +
          " <= " +
          (1 + m + 0.01) +
          "\n";
        model.subjectTo +=
          "pos_n" +
          node2.id +
          " - pos_n" +
          node1.id +
          " - " +
          m +
          " " +
          z1 +
          " >= " +
          (-1 - m - 0.01) +
          "\n";

        model.bounds += "binary " + z1 + "\n";

        model.subjectTo += "pos_n" + node1.id + " <= " + nodes.length + "\n";
        model.subjectTo += "pos_n" + node2.id + " <= " + nodes.length + "\n";
      }
    }
  }

  let cliquesExtended = cliques;

  for (let clique of cliques) {
    if (clique.nodes.length > 3) {
      for (let node of clique.nodes) {
        let new_clique = {
          nodes: clique.nodes.filter((n) => n != node),
        };

        if (
          cliquesExtended.some(
            (c) =>
              c.nodes.length == new_clique.nodes.length &&
              c.nodes.every((n) => new_clique.nodes.includes(n)),
          )
        )
          continue;
        cliquesExtended.push(new_clique);
      }
    }
  }

  for (let clique of cliquesExtended) {
    let node_list = clique.nodes;
    let c = "c_";

    for (node of node_list) {
      c += "n" + node;
    }

    model.objective_function += c + " + ";

    let z_list = [];

    for (let i = 0; i < node_list.length - 1; i++) {
      for (let j = i + 1; j < node_list.length; j++) {
        let n1 = node_list[i];
        let n2 = node_list[j];

        let z_n1n2 = "z_n" + n1 + "n" + n2;
        let z_n2n1 = "z_n" + n2 + "n" + n1;

        if (added_zvars.includes(z_n1n2)) {
          z_list.push(z_n1n2);
        } else if (added_zvars.includes(z_n2n1)) {
          z_list.push(z_n2n1);
        } else {
          console.warn(
            "Variable for nodes " + n1 + " and " + n2 + " not found.",
          );
        }
      }
    }

    let z_constraint = c;

    for (let zvar of z_list) {
      z_constraint += " + " + zvar;
    }

    z_constraint += " = " + node_list.length + " \n";

    model.subjectTo += z_constraint;
  }

  model.objective_function =
    model.objective_function.substring(0, model.objective_function.length - 2) +
    "\n\n";

  // Build LP model as a string
  return model.objective_function + model.subjectTo + model.bounds + "\nEnd\n";
}

function createOrderingEdgeProblemMAX(graph, previousSolution) {
      let edges = graph.links || graph.edges;
  let cliques = graph.cliques || [];

  const m = edges.length + 1;

  let model = {};

  model.objective_function = "Maximize \n";
  model.subjectTo = "Subject To \n";
  model.bounds = "\nBounds \n";

  let added_xvars = [];
  let added_zvars = [];

  let lines = previousSolution
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let line of lines) {
    if (line.startsWith("pos_n")) {
        let parts = line.split(" ");
        let varName = parts[0];
        let value = parts[1];
        model.subjectTo += varName + " = " + value + "\n";
    }
  }

  // add definition of variables on x
  for (let i = 0; i < edges.length - 1; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      let a = "e" + edges[i].id;
      let b = "e" + edges[j].id;
      let x_ab = "x_" + a + b;
      model.bounds += "binary " + x_ab + "\n";
      added_xvars.push(x_ab);
    }
  }

  // add transitivity constraints on x
  for (let i = 0; i < edges.length - 2; i++) {
    for (let j = i + 1; j < edges.length - 1; j++) {
      for (let k = j + 1; k < edges.length; k++) {
        if (i == j || i == k || j == k) continue;

        let x_ab = "x_e" + edges[i].id + "e" + edges[j].id;
        let x_bc = "x_e" + edges[j].id + "e" + edges[k].id;
        let x_ac = "x_e" + edges[i].id + "e" + edges[k].id;

        // check that all these exist
        if (!added_xvars.includes(x_ab)) console.warn(x_ab + " not found");
        if (!added_xvars.includes(x_bc)) console.warn(x_bc + " not found");
        if (!added_xvars.includes(x_ac)) console.warn(x_ac + " not found");

        model.subjectTo += x_ab + " + " + x_bc + " - " + x_ac + " >= 0\n";
        model.subjectTo +=
          "- " + x_ab + " - " + x_bc + " + " + x_ac + " >= - 1\n";
      }
    }
  }

  // compute position of edges
  for (let e1 of edges) {
    let pos_e1 = "pos_e" + e1.id;
    let tmp_accumulator = edges.length - 1;

    for (let e2 of edges) {
      if (e1 == e2) continue;
      let x_e1e2 = "x_e" + e1.id + "e" + e2.id;

      if (!added_xvars.includes(x_e1e2)) {
        pos_e1 += " - " + "x_e" + e2.id + "e" + e1.id;
        tmp_accumulator -= 1;
      } else {
        pos_e1 += " + " + x_e1e2;
      }
    }
    model.subjectTo += pos_e1 + " = " + tmp_accumulator + "\n";
    model.subjectTo += pos_e1 + " <= " + edges.length + "\n";
  }

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (i == j) continue;

      let edge1 = edges[i];
      let edge2 = edges[j];

      let sorted_edge_ids = [edge1.id, edge2.id].sort((a, b) => a - b);

      let z1 = "z_e" + sorted_edge_ids[0] + "e" + sorted_edge_ids[1];
      added_zvars.push(z1);

      model.subjectTo +=
        "pos_e" +
        edge2.id +
        " - pos_e" +
        edge1.id +
        " + " +
        m +
        " " +
        z1 +
        " <= " +
        (1 + m + 0.01) +
        "\n";
      model.subjectTo +=
        "pos_e" +
        edge2.id +
        " - pos_e" +
        edge1.id +
        " - " +
        m +
        " " +
        z1 +
        " >= " +
        (-1 - m - 0.01) +
        "\n";

      model.bounds += "binary " + z1 + "\n";
    }
  }

  let cliquesExtended = cliques;

  for (let clique of cliques) {
    if (clique.nodes.length > 3) {
      for (let node of clique.nodes) {
        let new_clique = {
          nodes: clique.nodes.filter((n) => n != node),
        };

        if (
          cliquesExtended.some(
            (c) =>
              c.nodes.length == new_clique.nodes.length &&
              c.nodes.every((n) => new_clique.nodes.includes(n)),
          )
        )
          continue;
        cliquesExtended.push(new_clique);
      }
    }
  }

  for (let clique of cliquesExtended) {
    let edge_list = [];

    edge_list = edges
      .filter(
        (e) =>
          clique.nodes.includes(e.source) && clique.nodes.includes(e.target),
      )
      .map((e) => e.id);

    clique.edges = edge_list;
  }

  for (let clique of cliquesExtended) {
    let edge_list = clique.edges;
    let d = "d_";

    for (edge of edge_list) {
      d += "e" + edge;
    }

    model.objective_function += d + " + ";

    let z_list = [];

    for (let i = 0; i < edge_list.length - 1; i++) {
      for (let j = i + 1; j < edge_list.length; j++) {
        let e1 = edge_list[i];
        let e2 = edge_list[j];

        let z_e1e2 = "z_e" + e1 + "e" + e2;
        let z_e2e1 = "z_e" + e2 + "e" + e1;

        if (added_zvars.includes(z_e1e2)) {
          z_list.push(z_e1e2);
        } else if (added_zvars.includes(z_e2e1)) {
          z_list.push(z_e2e1);
        } else {
          console.warn(
            "Variable for edges " + e1 + " and " + e2 + " not found.",
          );
        }
      }
    }

    let z_constraint = d;

    for (let zvar of z_list) {
      z_constraint += " - " + zvar;
    }

    z_constraint += " = 1 \n";

    model.subjectTo += z_constraint;
  }

  model.objective_function =
    model.objective_function.substring(0, model.objective_function.length - 2) +
    "\n\n";

  return model.objective_function + model.subjectTo + model.bounds + "\nEnd\n";
  
}

function createOrderingEdgeProblemMIN(graph, previousSolution) {
      let edges = graph.links || graph.edges;
  let cliques = graph.cliques || [];

  const m = edges.length + 1;

  let model = {};

  model.objective_function = "Minimize \n";
  model.subjectTo = "Subject To \n";
  model.bounds = "\nBounds \n";

  let added_xvars = [];
  let added_zvars = [];

  let lines = previousSolution
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let line of lines) {
    if (line.startsWith("pos_n")) {
        let parts = line.split(" ");
        let varName = parts[0];
        let value = parts[1];
        model.subjectTo += varName + " = " + value + "\n";
    }
  }

  // add definition of variables on x
  for (let i = 0; i < edges.length - 1; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      let a = "e" + edges[i].id;
      let b = "e" + edges[j].id;
      let x_ab = "x_" + a + b;
      model.bounds += "binary " + x_ab + "\n";
      added_xvars.push(x_ab);
    }
  }

  // add transitivity constraints on x
  for (let i = 0; i < edges.length - 2; i++) {
    for (let j = i + 1; j < edges.length - 1; j++) {
      for (let k = j + 1; k < edges.length; k++) {
        if (i == j || i == k || j == k) continue;

        let x_ab = "x_e" + edges[i].id + "e" + edges[j].id;
        let x_bc = "x_e" + edges[j].id + "e" + edges[k].id;
        let x_ac = "x_e" + edges[i].id + "e" + edges[k].id;

        // check that all these exist
        if (!added_xvars.includes(x_ab)) console.warn(x_ab + " not found");
        if (!added_xvars.includes(x_bc)) console.warn(x_bc + " not found");
        if (!added_xvars.includes(x_ac)) console.warn(x_ac + " not found");

        model.subjectTo += x_ab + " + " + x_bc + " - " + x_ac + " >= 0\n";
        model.subjectTo +=
          "- " + x_ab + " - " + x_bc + " + " + x_ac + " >= - 1\n";
      }
    }
  }

  // compute position of edges
  for (let e1 of edges) {
    let pos_e1 = "pos_e" + e1.id;
    let tmp_accumulator = edges.length - 1;

    for (let e2 of edges) {
      if (e1 == e2) continue;
      let x_e1e2 = "x_e" + e1.id + "e" + e2.id;

      if (!added_xvars.includes(x_e1e2)) {
        pos_e1 += " - " + "x_e" + e2.id + "e" + e1.id;
        tmp_accumulator -= 1;
      } else {
        pos_e1 += " + " + x_e1e2;
      }
    }
    model.subjectTo += pos_e1 + " = " + tmp_accumulator + "\n";
    model.subjectTo += pos_e1 + " <= " + edges.length + "\n";
  }

  for (let i = 0; i < edges.length; i++) {
    //model.subjectTo += "pos_e" + edges[i].id + " <= " + (edges.length - 1) + "\n"
    for (let j = i + 1; j < edges.length; j++) {
      if (i == j) continue;

      let edge1 = edges[i];
      let edge2 = edges[j];

      let sorted_edge_ids = [edge1.id, edge2.id].sort((a, b) => a - b);

      let z1 = "z_e" + sorted_edge_ids[0] + "e" + sorted_edge_ids[1];
      added_zvars.push(z1);

      model.subjectTo +=
        "pos_e" +
        edge2.id +
        " - pos_e" +
        edge1.id +
        " + " +
        m +
        " " +
        z1 +
        " <= " +
        (1 + m + 0.01) +
        "\n";
      model.subjectTo +=
        "pos_e" +
        edge2.id +
        " - pos_e" +
        edge1.id +
        " - " +
        m +
        " " +
        z1 +
        " >= " +
        (-1 - m - 0.01) +
        "\n";

      model.bounds += "binary " + z1 + "\n";
    }
  }

  let cliquesExtended = cliques;

  for (let clique of cliques) {
    if (clique.nodes.length > 3) {
      for (let node of clique.nodes) {
        let new_clique = {
          nodes: clique.nodes.filter((n) => n != node),
        };

        if (
          cliquesExtended.some(
            (c) =>
              c.nodes.length == new_clique.nodes.length &&
              c.nodes.every((n) => new_clique.nodes.includes(n)),
          )
        )
          continue;
        cliquesExtended.push(new_clique);
      }
    }
  }

  for (let clique of cliquesExtended) {
    let edge_list = [];

    edge_list = edges
      .filter(
        (e) =>
          clique.nodes.includes(e.source) && clique.nodes.includes(e.target),
      )
      .map((e) => e.id);

    clique.edges = edge_list;
  }

  for (let clique of cliquesExtended) {
    let edge_list = clique.edges;
    let d = "d_";

    for (edge of edge_list) {
      d += "e" + edge;
    }

    model.objective_function += d + " + ";

    let z_list = [];

    for (let i = 0; i < edge_list.length - 1; i++) {
      for (let j = i + 1; j < edge_list.length; j++) {
        let e1 = edge_list[i];
        let e2 = edge_list[j];

        let z_e1e2 = "z_e" + e1 + "e" + e2;
        let z_e2e1 = "z_e" + e2 + "e" + e1;

        if (added_zvars.includes(z_e1e2)) {
          z_list.push(z_e1e2);
        } else if (added_zvars.includes(z_e2e1)) {
          z_list.push(z_e2e1);
        } else {
          console.warn(
            "Variable for edges " + e1 + " and " + e2 + " not found.",
          );
        }
      }
    }

    let z_constraint = d;

    for (let zvar of z_list) {
      z_constraint += " + " + zvar;
    }

    z_constraint += " = " + edge_list.length + " \n";

    model.subjectTo += z_constraint;
  }

  model.objective_function =
    model.objective_function.substring(0, model.objective_function.length - 2) +
    "\n\n";

  // Build LP model as a string
  return model.objective_function + model.subjectTo + model.bounds + "\nEnd\n";
  
}

/**
 * Generates a personalized graph from clique groups.
 * @param {string} name - Graph name
 * @param {Object} params - Generation parameters
 * @param {Array<{
 *   nodesMin: number, nodesMax: number,
 *   intraProbMin: number, intraProbMax: number,
 *   interProbMin: number, interProbMax: number
 * }>} params.customParams
 *   Array of objects, one for each node group. Each field is a [min, max]
 *   interval sampled uniformly:
 *     - nodesMin / nodesMax: node count in the group (integers >= 1)
 *     - intraProbMin / intraProbMax: intra-clique probability (float in [0,1])
 *     - interProbMin / interProbMax: inter-clique probability (float in [0,1])
 *   Legacy schema is still supported: { numNodes, intraProb, interProb }
 *   (interpreted as degenerate ranges where min == max).
 * @param {number} [params.seed] Optional seed for reproducible RNG (Mulberry32).
 * @returns {{ name: string, nodes: Array, links: Array, cliques: Array }}
 *
 * NOTE: with a very high total number of nodes, this function can be slow
 *       (O(N^2) complexity for intra edges and O(N^2) for inter edges).
 */

// ── RNG helpers ────────────────────────────────────────────────────────────

/**
 * Mulberry32 seeded PRNG. Returns a function () => float in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Samples a uniform integer in [min, max] (inclusive).
 * @param {number} min
 * @param {number} max
 * @param {() => number} rng
 * @returns {number}
 */
function uniformInt(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Samples a uniform float in [min, max].
 * @param {number} min
 * @param {number} max
 * @param {() => number} rng
 * @returns {number}
 */
function uniformFloat(min, max, rng) {
  return rng() * (max - min) + min;
}

// ── Bron-Kerbosch with pivot: pushes ALL maximal cliques into `result`
function bronKerbosch(R, P, X, adjMap, result) {
  if (P.length === 0 && X.length === 0) {
    result.push([...R]);   // every leaf is a maximal clique
    return;
  }
  // pivot: choose vertex in P∪X with max connections in P
  const PX = [...P, ...X];
  const pivot = PX.reduce((u, v) => {
    const cu = P.filter(n => adjMap[u] && adjMap[u].has(n)).length;
    const cv = P.filter(n => adjMap[v] && adjMap[v].has(n)).length;
    return cv > cu ? v : u;
  });
  const pivotNeighbours = adjMap[pivot] ? [...adjMap[pivot]] : [];
  for (const v of P.filter(n => !pivotNeighbours.includes(n))) {
    const neighbours = adjMap[v] ? [...adjMap[v]] : [];
    bronKerbosch(
      [...R, v],
      P.filter(n => neighbours.includes(n)),
      X.filter(n => neighbours.includes(n)),
      adjMap,
      result,
    );
    P = P.filter(n => n !== v);
    X = [...X, v];
  }
}

// Returns ALL maximal cliques (size ≥ 2) within the group's induced subgraph.
// Falls back to the full groupNodes list when no edges exist at all.
function cliquesInGroup(groupNodes, links) {
  const nodeSet = new Set(groupNodes);
  const adjMap = {};
  for (const n of groupNodes) adjMap[n] = new Set();
  for (const l of links) {
    if (nodeSet.has(l.source) && nodeSet.has(l.target)) {
      adjMap[l.source].add(l.target);
      adjMap[l.target].add(l.source);
    }
  }
  const result = [];
  bronKerbosch([], [...groupNodes], [], adjMap, result);
  const meaningful = result.filter(c => c.length >= 3);
  return meaningful.length > 0 ? meaningful : [[...groupNodes]];
}

function findMaximalCliquesBronKerbosch(graph, minSize = 3) {
  const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph && (graph.links || graph.edges))
    ? (graph.links || graph.edges)
    : [];

  const allNodeIds = nodes.map(n => n.id);
  const adjMap = {};
  for (const id of allNodeIds) adjMap[id] = new Set();

  for (const l of links) {
    if (!adjMap[l.source] || !adjMap[l.target] || l.source === l.target) continue;
    adjMap[l.source].add(l.target);
    adjMap[l.target].add(l.source);
  }

  const rawCliques = [];
  bronKerbosch([], [...allNodeIds], [], adjMap, rawCliques);

  const filtered = rawCliques
    .filter(c => c.length >= minSize)
    .map(c => [...c].sort((a, b) => a - b));

  // dedupe cliques by sorted node signature
  const seen = new Set();
  const unique = [];
  for (const c of filtered) {
    const key = c.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  return unique;
}

// ── generatePersonalizedGraph ──────────────────────────────────────────────

function generateGraphJson(name, params) {
  // Accept either a parsed array or a JSON string
  let customParams = params.customParams;
  if (typeof customParams === 'string') {
    try { customParams = JSON.parse(customParams); } catch (e) {
      throw new Error('customParams non è un JSON valido: ' + e.message);
    }
  }
  if (!Array.isArray(customParams) || customParams.length === 0) {
    throw new Error('customParams deve essere un array non vuoto di oggetti clique.');
  }

  // ── RNG setup ────────────────────────────────────────────────────────────
  const rng = (params.seed !== undefined && params.seed !== null)
    ? mulberry32(Number(params.seed))
    : Math.random.bind(Math);

  // ── Normalize and validate each group definition ─────────────────────────
  const normalized = customParams.map((p, i) => {
    let nodesMin, nodesMax, intraProbMin, intraProbMax, interProbMin, interProbMax;

    if (p.numNodes !== undefined && p.nodesMin === undefined) {
      // Legacy schema: { numNodes, intraProb, interProb }
      nodesMin = nodesMax = p.numNodes;
      intraProbMin = intraProbMax = p.intraProb;
      interProbMin = interProbMax = p.interProb;
    } else {
      ({ nodesMin, nodesMax, intraProbMin, intraProbMax, interProbMin, interProbMax } = p);
    }

    // Node validation
    if (!Number.isInteger(nodesMin) || !Number.isInteger(nodesMax))
      throw new Error(`customParams[${i}]: nodesMin e nodesMax devono essere interi.`);
    if (nodesMin < 1)
      throw new Error(`customParams[${i}]: nodesMin deve essere >= 1 (trovato: ${nodesMin}).`);
    if (nodesMax < nodesMin)
      throw new Error(`customParams[${i}]: nodesMax (${nodesMax}) deve essere >= nodesMin (${nodesMin}).`);

    // Probability validation
    for (const [fname, val] of [
      ['intraProbMin', intraProbMin], ['intraProbMax', intraProbMax],
      ['interProbMin', interProbMin], ['interProbMax', interProbMax],
    ]) {
      if (typeof val !== 'number' || isNaN(val) || val < 0 || val > 1)
        throw new Error(`customParams[${i}]: ${fname} deve essere un numero in [0, 1] (trovato: ${val}).`);
    }
    if (intraProbMax < intraProbMin)
      throw new Error(`customParams[${i}]: intraProbMax deve essere >= intraProbMin.`);
    if (interProbMax < interProbMin)
      throw new Error(`customParams[${i}]: interProbMax deve essere >= interProbMin.`);

    return { nodesMin, nodesMax, intraProbMin, intraProbMax, interProbMin, interProbMax };
  });

  const nodes   = [];
  const links   = [];
  const cliques = [];

  let nodeIdCounter = 0;
  let edgeIdCounter = 1;

  // ── 1. Sample values for each group and create nodes ─────────────────────
  const groups = normalized.map(({ nodesMin, nodesMax, intraProbMin, intraProbMax, interProbMin, interProbMax }) => {
    const numNodes  = uniformInt(nodesMin, nodesMax, rng);
    const intraProb = uniformFloat(intraProbMin, intraProbMax, rng);
    const interProb = uniformFloat(interProbMin, interProbMax, rng);

    const groupNodes = [];
    for (let i = 0; i < numNodes; i++) {
      nodes.push({ id: nodeIdCounter });
      groupNodes.push(nodeIdCounter);
      nodeIdCounter++;
    }
    return { groupNodes, intraProb, interProb };
  });

  // ── 2. Intra-group edges ─────────────────────────────────────────────────
  for (let g = 0; g < groups.length; g++) {
    const { groupNodes, intraProb } = groups[g];
    for (let i = 0; i < groupNodes.length - 1; i++) {
      for (let j = i + 1; j < groupNodes.length; j++) {
        if (rng() < intraProb) {
          links.push({ id: edgeIdCounter++, source: groupNodes[i], target: groupNodes[j] });
        }
      }
    }
  }

  // ── 3. Inter-group edges (average of the two groups' interProb) ──────────
  for (let g1 = 0; g1 < groups.length - 1; g1++) {
    for (let g2 = g1 + 1; g2 < groups.length; g2++) {
      const interProb = (groups[g1].interProb + groups[g2].interProb) / 2;
      for (const u of groups[g1].groupNodes) {
        for (const v of groups[g2].groupNodes) {
          if (rng() < interProb) {
            links.push({ id: edgeIdCounter++, source: u, target: v });
          }
        }
      }
    }
  }

  // ── 4. Bron-Kerbosch on the full graph (intra + inter) ───────────────────
  // All maximal cliques of size >= 3 found on the whole graph
  const allNodeIds = nodes.map(n => n.id);
  const foundCliques = cliquesInGroup(allNodeIds, links);
  foundCliques.forEach(c => cliques.push({ id: cliques.length + 1, nodes: c }));

  return { name, nodes, links, cliques };
}

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} deve essere un intero > 0 (trovato: ${value}).`);
  }
}

function assertNumberInRange(name, value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
    throw new Error(`${name} deve essere un numero in [${min}, ${max}] (trovato: ${value}).`);
  }
}

function chooseRandomSubset(pool, count, rng) {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = uniformInt(0, i, rng);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, Math.min(count, arr.length)));
}

function buildLinksFromEdgeSet(edgeSet) {
  const links = [];
  let edgeId = 1;
  for (const key of edgeSet) {
    const [a, b] = key.split('|').map((v) => parseInt(v, 10));
    links.push({ id: edgeId++, source: a, target: b });
  }
  return links;
}

function makeEdgeKey(a, b) {
  const u = Math.min(a, b);
  const v = Math.max(a, b);
  return `${u}|${v}`;
}

function buildAdjacencyFromEdgeSet(nodeIds, edgeSet) {
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, new Set());
  for (const key of edgeSet) {
    const [a, b] = key.split('|').map((v) => parseInt(v, 10));
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return adj;
}

function getConnectedComponents(nodeIds, edgeSet) {
  const adj = buildAdjacencyFromEdgeSet(nodeIds, edgeSet);
  const visited = new Set();
  const comps = [];

  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    const comp = [];
    const stack = [start];
    visited.add(start);

    while (stack.length > 0) {
      const cur = stack.pop();
      comp.push(cur);
      for (const nb of adj.get(cur)) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    comps.push(comp);
  }

  return comps;
}

function enforceConnectedGraph(nodeIds, edgeSet, rng) {
  if (nodeIds.length <= 1) return;

  let components = getConnectedComponents(nodeIds, edgeSet);
  if (components.length <= 1) return;

  // Connect components in a chain to guarantee one connected component.
  for (let i = 0; i < components.length - 1; i++) {
    const aComp = components[i];
    const bComp = components[i + 1];
    const a = aComp[uniformInt(0, aComp.length - 1, rng)];
    const b = bComp[uniformInt(0, bComp.length - 1, rng)];
    edgeSet.add(makeEdgeKey(a, b));
  }
}

function buildExperimentalSingleGraph(name, cfg, rng) {
  const numNodes = Number.isInteger(cfg.fixedNodes)
    ? cfg.fixedNodes
    : uniformInt(cfg.minNodes, cfg.maxNodes, rng);

  const targetCliques = Number.isInteger(cfg.fixedCliques)
    ? cfg.fixedCliques
    : uniformInt(cfg.minCliques, cfg.maxCliques, rng);

  const nodes = Array.from({ length: numNodes }, (_, i) => ({ id: i }));
  const allNodeIds = nodes.map((n) => n.id);
  const edgeSet = new Set();
  let reusePool = [];

  for (let c = 0; c < targetCliques; c++) {
    const localMin = Math.max(2, Math.min(cfg.minCliqueSize, numNodes));
    const localMax = Math.max(localMin, Math.min(cfg.maxCliqueSize, numNodes));

    let sampledSize;
    if (typeof cfg.avgCliqueSize === 'number' && !Number.isNaN(cfg.avgCliqueSize)) {
      const band = Math.max(0.5, (localMax - localMin) / 3);
      const jitter = uniformFloat(-band, band, rng);
      sampledSize = Math.round(cfg.avgCliqueSize + jitter);
      sampledSize = Math.max(localMin, Math.min(localMax, sampledSize));
    } else {
      sampledSize = uniformInt(localMin, localMax, rng);
    }

    const overlapQuota = reusePool.length > 0
      ? Math.min(sampledSize - 1, Math.floor(sampledSize * uniformFloat(0.15, 0.5, rng)))
      : 0;

    const overlapped = overlapQuota > 0 ? chooseRandomSubset(reusePool, overlapQuota, rng) : [];
    const remainingCount = sampledSize - overlapped.length;
    const remainingCandidates = allNodeIds.filter((id) => !overlapped.includes(id));
    const fresh = chooseRandomSubset(remainingCandidates, remainingCount, rng);
    const cliqueNodes = [...new Set([...overlapped, ...fresh])];

    for (let i = 0; i < cliqueNodes.length - 1; i++) {
      for (let j = i + 1; j < cliqueNodes.length; j++) {
        edgeSet.add(makeEdgeKey(cliqueNodes[i], cliqueNodes[j]));
      }
    }

    reusePool = [...new Set([...reusePool, ...cliqueNodes])];
  }

  const noiseProb = Math.min(0.1, Math.max(0.005, 1 / Math.max(10, numNodes * 1.2)));
  for (let i = 0; i < allNodeIds.length - 1; i++) {
    for (let j = i + 1; j < allNodeIds.length; j++) {
      const key = makeEdgeKey(allNodeIds[i], allNodeIds[j]);
      if (!edgeSet.has(key) && rng() < noiseProb) {
        edgeSet.add(key);
      }
    }
  }

  // Enforce connected topology so there are no isolated/sparse standalone nodes.
  enforceConnectedGraph(allNodeIds, edgeSet, rng);

  const links = buildLinksFromEdgeSet(edgeSet);
  const cliqueArrays = findMaximalCliquesBronKerbosch({ nodes, links }, 3);
  const cliques = cliqueArrays.map((cNodes, idx) => ({ id: idx + 1, nodes: cNodes }));

  return { name, nodes, links, cliques };
}

function validateDatasetSperimentazioneParams(params, fallbackSetName) {
  const mode = String(params.mode || 'single').toLowerCase();
  if (!['single', 'set'].includes(mode)) {
    throw new Error(`mode non valido: ${params.mode}. Valori supportati: single, set.`);
  }

  const minNodes = Number(params.minNodes);
  const maxNodes = Number(params.maxNodes);
  const minCliqueSize = Number(params.minCliqueSize);
  const maxCliqueSize = Number(params.maxCliqueSize);
  const avgCliqueSize = Number(params.avgCliqueSize);
  const minCliques = Number(params.minCliques);
  const maxCliques = Number(params.maxCliques);

  assertPositiveInteger('minNodes', minNodes);
  assertPositiveInteger('maxNodes', maxNodes);
  if (minNodes > maxNodes) {
    throw new Error(`Intervallo nodi non valido: minNodes (${minNodes}) > maxNodes (${maxNodes}).`);
  }

  assertPositiveInteger('minCliqueSize', minCliqueSize);
  assertPositiveInteger('maxCliqueSize', maxCliqueSize);
  if (minCliqueSize > maxCliqueSize) {
    throw new Error(`Intervallo dimensione clique non valido: minCliqueSize (${minCliqueSize}) > maxCliqueSize (${maxCliqueSize}).`);
  }
  if (maxCliqueSize > maxNodes) {
    throw new Error(`maxCliqueSize (${maxCliqueSize}) non puo superare maxNodes (${maxNodes}).`);
  }

  assertNumberInRange('avgCliqueSize', avgCliqueSize, minCliqueSize, maxCliqueSize);
  assertPositiveInteger('minCliques', minCliques);
  assertPositiveInteger('maxCliques', maxCliques);
  if (minCliques > maxCliques) {
    throw new Error(`Intervallo numero clique non valido: minCliques (${minCliques}) > maxCliques (${maxCliques}).`);
  }

  const normalized = {
    mode,
    seed: params.seed,
    minNodes,
    maxNodes,
    minCliqueSize,
    maxCliqueSize,
    avgCliqueSize,
    minCliques,
    maxCliques,
  };

  if (mode === 'set') {
    const setNameRaw = (params.setName || fallbackSetName || '').trim();
    const setName = setNameRaw.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!setName) {
      throw new Error('setName obbligatorio in modalita set.');
    }

    const nodeStep = params.nodeStep !== undefined && params.nodeStep !== null
      ? Number(params.nodeStep)
      : null;
    const graphsPerNodeStep = params.graphsPerNodeStep !== undefined && params.graphsPerNodeStep !== null
      ? Number(params.graphsPerNodeStep)
      : null;
    const cliqueStep = params.cliqueStep !== undefined && params.cliqueStep !== null
      ? Number(params.cliqueStep)
      : null;
    const graphsPerCliqueStep = params.graphsPerCliqueStep !== undefined && params.graphsPerCliqueStep !== null
      ? Number(params.graphsPerCliqueStep)
      : null;

    const hasNodeAxis = nodeStep !== null || graphsPerNodeStep !== null;
    const hasCliqueAxis = cliqueStep !== null || graphsPerCliqueStep !== null;

    if (!hasNodeAxis && !hasCliqueAxis) {
      throw new Error('In modalita set devi definire almeno nodeStep+graphsPerNodeStep o cliqueStep+graphsPerCliqueStep.');
    }

    if (hasNodeAxis) {
      assertPositiveInteger('nodeStep', nodeStep);
      assertPositiveInteger('graphsPerNodeStep', graphsPerNodeStep);
    }

    if (hasCliqueAxis) {
      assertPositiveInteger('cliqueStep', cliqueStep);
      assertPositiveInteger('graphsPerCliqueStep', graphsPerCliqueStep);
    }

    normalized.setName = setName;
    normalized.nodeStep = hasNodeAxis ? nodeStep : null;
    normalized.graphsPerNodeStep = hasNodeAxis ? graphsPerNodeStep : null;
    normalized.cliqueStep = hasCliqueAxis ? cliqueStep : null;
    normalized.graphsPerCliqueStep = hasCliqueAxis ? graphsPerCliqueStep : null;
  }

  return normalized;
}

function persistGraphSetArtifacts(baseDir, setName, metadata) {
  const setRoot = path.join(baseDir, 'graphs', setName);
  fs.mkdirSync(setRoot, { recursive: true });

  for (const g of metadata.graphs) {
    if (!g || g.status === 'failed' || !g.graph) continue;
    const graphAbs = path.join(setRoot, g.filePath);
    fs.writeFileSync(graphAbs, JSON.stringify(g.graph, null, 2), 'utf8');
  }

  const metadataPayload = {
    setName: metadata.setName,
    createdAt: metadata.createdAt,
    parameters: metadata.parameters,
    graphs: metadata.graphs.map((g) => ({
      id: g.id,
      filePath: g.filePath,
      nodes: g.nodes,
      edges: g.edges,
      cliques: g.cliques,
      step: g.step,
      status: g.status,
      error: g.error || null,
      axis: g.axis || null,
      axisValue: g.axisValue,
    })),
    failures: metadata.failures,
  };

  const metadataPath = path.join(baseDir, `${setName}.json`);
  const tempPath = `${metadataPath}.tmp-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(metadataPayload, null, 2), 'utf8');
  fs.renameSync(tempPath, metadataPath);

  return metadataPayload;
}

function generateGraphJsonDatasetSperimentazione(name, params) {
  if (!params || typeof params !== 'object') {
    throw new Error('params obbligatorio per dataset-sperimentazione.');
  }

  // Legacy fallback: preserve old generator UI payload when customParams is provided.
  if (Array.isArray(params.customParams)) {
    return generateGraphJson(name, params);
  }

  const cfg = validateDatasetSperimentazioneParams(params, name);
  const baseRng = (cfg.seed !== undefined && cfg.seed !== null)
    ? mulberry32(Number(cfg.seed))
    : Math.random.bind(Math);

  if (cfg.mode === 'single') {
    return buildExperimentalSingleGraph(name, cfg, baseRng);
  }

  const generatedAt = new Date().toISOString();
  const setName = cfg.setName;
  const steps = [];

  if (cfg.nodeStep && cfg.graphsPerNodeStep) {
    for (let n = cfg.minNodes, s = 0; n <= cfg.maxNodes; n += cfg.nodeStep, s++) {
      steps.push({ axis: 'nodes', axisValue: n, step: s, repeats: cfg.graphsPerNodeStep });
    }
  }

  if (cfg.cliqueStep && cfg.graphsPerCliqueStep) {
    const startStep = steps.length;
    for (let c = cfg.minCliques, s = 0; c <= cfg.maxCliques; c += cfg.cliqueStep, s++) {
      steps.push({ axis: 'cliques', axisValue: c, step: startStep + s, repeats: cfg.graphsPerCliqueStep });
    }
  }

  const metadata = {
    setName,
    createdAt: generatedAt,
    parameters: {
      mode: 'set',
      setName,
      seed: cfg.seed,
      minNodes: cfg.minNodes,
      maxNodes: cfg.maxNodes,
      nodeStep: cfg.nodeStep,
      graphsPerNodeStep: cfg.graphsPerNodeStep,
      minCliqueSize: cfg.minCliqueSize,
      maxCliqueSize: cfg.maxCliqueSize,
      avgCliqueSize: cfg.avgCliqueSize,
      minCliques: cfg.minCliques,
      maxCliques: cfg.maxCliques,
      cliqueStep: cfg.cliqueStep,
      graphsPerCliqueStep: cfg.graphsPerCliqueStep,
    },
    graphs: [],
    failures: [],
  };

  let graphCounter = 1;
  for (const st of steps) {
    for (let i = 0; i < st.repeats; i++) {
      const graphId = `${setName}_s${String(st.step).padStart(3, '0')}_g${String(i + 1).padStart(3, '0')}`;
      const graphFile = `${graphId}.json`;
      try {
        const graphCfg = {
          ...cfg,
          fixedNodes: st.axis === 'nodes' ? st.axisValue : undefined,
          fixedCliques: st.axis === 'cliques' ? st.axisValue : undefined,
        };
        const graph = buildExperimentalSingleGraph(graphId, graphCfg, baseRng);
        metadata.graphs.push({
          id: graphId,
          filePath: graphFile,
          nodes: graph.nodes.length,
          edges: graph.links.length,
          cliques: (graph.cliques || []).map((c) => c.nodes.length),
          step: st.step,
          status: 'ok',
          axis: st.axis,
          axisValue: st.axisValue,
          graph,
        });
      } catch (err) {
        metadata.failures.push({
          id: graphId,
          step: st.step,
          axis: st.axis,
          axisValue: st.axisValue,
          error: err.message,
        });
        metadata.graphs.push({
          id: graphId,
          filePath: graphFile,
          nodes: 0,
          edges: 0,
          cliques: [],
          step: st.step,
          status: 'failed',
          axis: st.axis,
          axisValue: st.axisValue,
          error: err.message,
        });
      }
      graphCounter++;
    }
  }

  const setsBase = path.join(__dirname, 'data', 'sets');
  fs.mkdirSync(setsBase, { recursive: true });
  return persistGraphSetArtifacts(setsBase, setName, metadata);
}


module.exports = {
  createCliqueModelFromGraph,
  createCliqueModelFromGraphMAX,
  createCliqueModelFromGraphMIN,
  findMaximalCliquesBronKerbosch,
  generateGraphJson,
  generateGraphJsonDatasetSperimentazione,
};
