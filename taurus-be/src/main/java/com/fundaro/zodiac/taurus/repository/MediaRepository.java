package com.fundaro.zodiac.taurus.repository;

import com.fundaro.zodiac.taurus.domain.Media;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface MediaRepository extends CatalogRepository<Media> {

    @Query("select media.storageKey from Media media where media.deleted = false")
    List<String> findActiveStorageKeys();

    @Query(
        value = """
            SELECT NOT EXISTS (
                SELECT 1 FROM sheet_music_media WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM upload_job WHERE source_media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM onboarding_import_job WHERE source_media_asset_id = :id AND source_removed_at IS NULL
                UNION ALL
                SELECT 1 FROM inventory_item_photo WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM inventory_return_photo WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM inventory_loan_sheet_export WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM inventory_issue_photo WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM financial_movement_attachment WHERE media_asset_id = :id AND deleted = FALSE AND active = TRUE
                UNION ALL
                SELECT 1 FROM score_version WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM arrangement_version WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM score_engraving_job WHERE pdf_media_asset_id = :id AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM score_engraving_page WHERE media_asset_id = :id
                UNION ALL
                SELECT 1 FROM signature_document
                 WHERE :id IN (frozen_media_asset_id, signed_media_asset_id, sealed_media_asset_id) AND deleted = FALSE
                UNION ALL
                SELECT 1 FROM signature_act WHERE attestation_media_asset_id = :id AND deleted = FALSE
            )
            """,
        nativeQuery = true
    )
    boolean isUnreferenced(@Param("id") Long id);

    /**
     * Pages of active parts that the user can see: the track is in one of the given states and the part is assigned to at
     * least one of the user's instruments. Written in SQL because the soft-deleted association rows of
     * {@code user_instrument} are not filtered out by criteria joins.
     */
    String VISIBLE_SHEET_MUSIC_PAGES = """
        SELECT relation.media_asset_id
          FROM sheet_music_media relation
          JOIN sheet_music score ON score.id = relation.sheet_music_id AND score.deleted = FALSE
          JOIN track ON track.id = score.track_id AND track.deleted = FALSE AND track.state IN (:states)
          JOIN sheet_music_instrument score_instrument
            ON score_instrument.sheet_music_id = score.id AND score_instrument.deleted = FALSE
          JOIN user_instrument assigned
            ON assigned.instrument_id = score_instrument.instrument_id AND assigned.deleted = FALSE
          JOIN app_user member ON member.id = assigned.user_id AND member.deleted = FALSE
         WHERE relation.deleted = FALSE
           AND member.keycloak_id = :keycloakId
        """;

    @Query(value = "SELECT EXISTS (" + VISIBLE_SHEET_MUSIC_PAGES + " AND relation.media_asset_id = :id)", nativeQuery = true)
    boolean hasVisibleSheetMusicReference(
        @Param("id") Long id,
        @Param("keycloakId") String keycloakId,
        @Param("states") Collection<String> states
    );

    @Query(value = "SELECT DISTINCT visible.media_asset_id FROM (" + VISIBLE_SHEET_MUSIC_PAGES + ") visible", nativeQuery = true)
    List<Long> findVisibleSheetMusicMediaIds(@Param("keycloakId") String keycloakId, @Param("states") Collection<String> states);

    @Query(value = "SELECT EXISTS (SELECT 1 FROM financial_movement_attachment WHERE media_asset_id = :id AND deleted = FALSE AND active = TRUE)", nativeQuery = true)
    boolean hasFinanceReference(@Param("id") Long id);

    @Query(
        value = """
            SELECT EXISTS (
                SELECT 1 FROM inventory_item_photo WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL SELECT 1 FROM inventory_return_photo WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL SELECT 1 FROM inventory_loan_sheet_export WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL SELECT 1 FROM inventory_issue_photo WHERE media_asset_id = :id AND deleted = FALSE
            )
            """,
        nativeQuery = true
    )
    boolean hasInventoryReference(@Param("id") Long id);

    @Query(
        value = """
            SELECT EXISTS (
                SELECT 1 FROM sheet_music_media WHERE media_asset_id = :id AND deleted = FALSE
                UNION ALL SELECT 1 FROM upload_job WHERE source_media_asset_id = :id AND deleted = FALSE
            )
            """,
        nativeQuery = true
    )
    boolean hasUnrestrictedReference(@Param("id") Long id);
}
