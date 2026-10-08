use std::collections::{HashMap, HashSet, VecDeque};

use sqlx::SqliteConnection;

use super::super::models::ArchivePreview;
use crate::error::AppError;

#[derive(Debug)]
struct FeatureNode {
    active: bool,
}

#[derive(Debug)]
pub(super) struct ArchiveGraph {
    nodes: HashMap<i64, FeatureNode>,
    parent_by_child: HashMap<i64, i64>,
}

impl ArchiveGraph {
    pub(super) fn preview(&self, selected_id: i64) -> ArchivePreview {
        let selected_is_cyclic = self.has_ancestry_cycle(selected_id);
        let has_parent = self
            .parent_by_child
            .get(&selected_id)
            .filter(|id| **id != selected_id)
            .is_some_and(|id| !selected_is_cyclic && self.is_same_project(*id));
        let parent_ids = self
            .parent_by_child
            .get(&selected_id)
            .copied()
            .filter(|id| *id != selected_id)
            .filter(|_| !selected_is_cyclic)
            .filter(|id| self.is_active_same_project(*id))
            .into_iter()
            .collect();
        let all_descendants = if selected_is_cyclic {
            Vec::new()
        } else {
            self.descendants(selected_id)
        };
        ArchivePreview {
            parent_ids,
            descendant_ids: all_descendants
                .iter()
                .copied()
                .filter(|id| self.is_active_same_project(*id))
                .collect(),
            has_relations: has_parent || !all_descendants.is_empty(),
        }
    }

    fn is_same_project(&self, id: i64) -> bool {
        self.nodes.contains_key(&id)
    }

    fn is_active_same_project(&self, id: i64) -> bool {
        self.nodes.get(&id).is_some_and(|node| node.active)
    }

    fn has_ancestry_cycle(&self, id: i64) -> bool {
        let mut visited = HashSet::from([id]);
        let mut parent = self.parent_by_child.get(&id).copied();
        while let Some(parent_id) = parent {
            if !visited.insert(parent_id) {
                return true;
            }
            parent = self.parent_by_child.get(&parent_id).copied();
        }
        false
    }

    fn descendants(&self, selected_id: i64) -> Vec<i64> {
        let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
        for (&child, &parent) in &self.parent_by_child {
            if child != parent && self.nodes.contains_key(&parent) {
                children.entry(parent).or_default().push(child);
            }
        }
        for values in children.values_mut() {
            values.sort_unstable();
        }
        let mut visited = HashSet::from([selected_id]);
        let mut queue = VecDeque::from([selected_id]);
        let mut descendants = Vec::new();
        while let Some(parent) = queue.pop_front() {
            for child in children.get(&parent).into_iter().flatten() {
                if visited.insert(*child) {
                    queue.push_back(*child);
                    descendants.push(*child);
                }
            }
        }
        descendants
    }
}

pub(super) async fn load_graph(
    connection: &mut SqliteConnection,
    selected_id: i64,
) -> Result<ArchiveGraph, AppError> {
    let selected_project_id: i64 =
        sqlx::query_scalar("SELECT project_id FROM features WHERE id = ?")
            .bind(selected_id)
            .fetch_optional(&mut *connection)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("feature {selected_id} not found")))?;
    let features: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, status FROM features WHERE project_id = ?")
            .bind(selected_project_id)
            .fetch_all(&mut *connection)
            .await?;
    let nodes = features
        .into_iter()
        .map(|(id, status)| {
            (
                id,
                FeatureNode {
                    active: status == "active",
                },
            )
        })
        .collect();
    let links: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT target_session.feature_id, source_session.feature_id \
         FROM agent_session_links link \
         JOIN agent_sessions target_session ON target_session.id = link.target_session_id \
         JOIN agent_sessions source_session ON source_session.id = link.source_session_id \
         JOIN features target_feature ON target_feature.id = target_session.feature_id \
         WHERE link.link_type IN ('spawned', 'handoff') \
           AND target_feature.project_id = ? \
         ORDER BY link.created_at ASC, link.id ASC",
    )
    .bind(selected_project_id)
    .fetch_all(&mut *connection)
    .await?;
    let mut parent_by_child = HashMap::new();
    for (child, parent) in links {
        parent_by_child.entry(child).or_insert(parent);
    }
    Ok(ArchiveGraph {
        nodes,
        parent_by_child,
    })
}
