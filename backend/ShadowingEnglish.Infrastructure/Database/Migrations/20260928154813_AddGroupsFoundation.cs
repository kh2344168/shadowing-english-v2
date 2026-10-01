using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations
{
    public partial class AddGroupsFoundation : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StudyGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    CreateRequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedByAdminId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StudyGroups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StudyGroups_AspNetUsers_CreatedByAdminId",
                        column: x => x.CreatedByAdminId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StudentGroupMemberships",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    StudentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    EndedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AssignedByAdminId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EndedByAdminId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StudentGroupMemberships", x => x.Id);
                    table.CheckConstraint("CK_StudentGroupMemberships_EndAfterStart",
                        "[EndedAtUtc] IS NULL OR [EndedAtUtc] >= [StartedAtUtc]");
                    table.ForeignKey(
                        name: "FK_StudentGroupMemberships_AspNetUsers_AssignedByAdminId",
                        column: x => x.AssignedByAdminId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StudentGroupMemberships_AspNetUsers_EndedByAdminId",
                        column: x => x.EndedByAdminId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StudentGroupMemberships_AspNetUsers_StudentId",
                        column: x => x.StudentId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StudentGroupMemberships_StudyGroups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "StudyGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StudyGroups_CreatedByAdminId", table: "StudyGroups", column: "CreatedByAdminId");
            migrationBuilder.CreateIndex(
                name: "IX_StudyGroups_CreateRequestId", table: "StudyGroups", column: "CreateRequestId", unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_StudentGroupMemberships_AssignedByAdminId", table: "StudentGroupMemberships",
                column: "AssignedByAdminId");
            migrationBuilder.CreateIndex(
                name: "IX_StudentGroupMemberships_EndedByAdminId", table: "StudentGroupMemberships",
                column: "EndedByAdminId");
            migrationBuilder.CreateIndex(
                name: "IX_StudentGroupMemberships_GroupId_EndedAtUtc", table: "StudentGroupMemberships",
                columns: new[] { "GroupId", "EndedAtUtc" });
            migrationBuilder.CreateIndex(
                name: "IX_StudentGroupMemberships_StudentId_StartedAtUtc", table: "StudentGroupMemberships",
                columns: new[] { "StudentId", "StartedAtUtc" });
            migrationBuilder.CreateIndex(
                name: "UX_StudentGroupMemberships_ActiveStudent", table: "StudentGroupMemberships",
                column: "StudentId", unique: true, filter: "[EndedAtUtc] IS NULL");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "StudentGroupMemberships");
            migrationBuilder.DropTable(name: "StudyGroups");
        }
    }
}
